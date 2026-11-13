// Diagnostics spine reporting for the macOS .app sidecar.
//
// The sidecar is the ONE desktop component that can emit a CONFORMING spine
// report: it already holds an authenticated cassette.digital client
// (callCassetteAPI / liveState.BearerToken) and a durable, persistent state file
// to anchor an anonymous install_id. The Tauri shell and the native menu-bar
// agent stay LOCAL for v1 (reveal-only, no upload) — only this process POSTs.
//
// What it reports (POST /api/diagnostics/reports, HYBRID architecture — the
// spine owns NATIVE faults; web errors stay on Sentry):
//   - report_type=unhandled_error — a recovered HTTP-handler panic
//     (recoverMiddleware). net/http already recovers per-connection, so this
//     does NOT change crash-vs-not; it only adds durable logging + a report.
//   - report_type=crash — the supervisor's fatal Navidrome-startup exits
//     (superviseFatal), the paths that drive the .app crash loop. It does NOT
//     stop those log.Fatal/os.Exit crashes; it flushes a report first.
//
// Consent is OPT-OUT: crashes/errors auto-upload with consent.user_consented=false
// (the locked model — a full diagnostic_export, which this file does NOT send,
// is the only thing that requires an explicit user share). Set
// CASSETTE_DIAGNOSTICS=off to disable all reporting.

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

// diagnosticsEndpoint is the spine ingest path on the cassette.digital host
// (cassetteBase). Anonymous-allowed: no auth required, but if a bearer is
// present the server stamps the account onto the report.
const diagnosticsEndpoint = "/api/diagnostics/reports"

// diagnosticsEnabled reports whether the sidecar may emit reports. Opt-OUT: on
// by default; CASSETTE_DIAGNOSTICS in {off,0,false,no} disables it.
func diagnosticsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CASSETTE_DIAGNOSTICS"))) {
	case "off", "0", "false", "no":
		return false
	}
	return true
}

// newUUID returns an RFC 4122 v4 UUID string. Used for both the persistent
// install_id and the per-report idempotency_key.
func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing is near-impossible; degrade to a time-derived value
		// so the required id fields are still populated (correlation weakens, the
		// report still sends).
		return fmt.Sprintf("00000000-0000-4000-8000-%012x", time.Now().UnixNano()&0xffffffffffff)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ensureInstallID mints a persistent anonymous install_id on first run and
// returns it. Persisted via saveState so it is stable across relaunches.
func ensureInstallID(state *SidecarState) string {
	if state == nil {
		return ""
	}
	if state.InstallID == "" {
		state.InstallID = newUUID()
		if err := saveState(state); err != nil {
			log.Printf("diagnostics: could not persist install_id: %v", err)
		}
	}
	return state.InstallID
}

// diagnosticsIdentity resolves the (install_id, bearer_token) pair for a report.
// It prefers the in-process liveState, but falls back to reading state from disk
// so the SUPERVISOR fatal paths — which run in main() BEFORE loadState() — can
// still stamp a stable install_id (minting + persisting one if absent).
func diagnosticsIdentity() (installID, token string) {
	if liveState != nil {
		return ensureInstallID(liveState), liveState.BearerToken
	}
	s, err := loadState()
	if err != nil || s == nil {
		return "", ""
	}
	return ensureInstallID(s), s.BearerToken
}

// macOSVersion returns the product version (e.g. "15.4") best-effort, empty off
// darwin or on any failure.
func macOSVersion() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	out, err := exec.Command("sw_vers", "-productVersion").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// diagnosticsReport is the small internal shape a caller fills; sendReport maps
// it to the snake_case wire body and stamps the shared fields (schema_version,
// idempotency_key, platform, install_id, consent, …).
type diagnosticsReport struct {
	ReportType   string                 // 'crash' | 'unhandled_error' | 'user_feedback' | …
	Component    string                 // free-text sub-surface; defaults to "sidecar"
	Severity     string                 // 'fatal' | 'error' | 'warning' | 'info'
	Title        string                 // short human summary
	Fingerprint  string                 // grouping key
	Context      map[string]interface{} // small inline state (<64KB serialized)
	CrashSummary map[string]interface{} // small head: name/message + top frames
	// UserMessage carries the free-text body of a MANUAL user_feedback report
	// (Feature B). Empty for auto reports; mapped to the wire `user_message`.
	UserMessage string
	// AttachLogTail, when set, declares a rolling_trace attachment carrying the
	// tail of sidecar.log and drives the two-step R2 upload after the report is
	// accepted (Feature C). Used on crash reports — the .app crash loop's cause
	// lives in that tail. Screenshots are NOT meaningful for this headless
	// process, so only the log tail is attached.
	AttachLogTail bool
}

// isAutoReport reports whether a report type is auto-generated telemetry
// (crash / hang / unhandled_error) and therefore subject to the
// diagnosticsConsent opt-out. user_feedback and diagnostic_export are
// user-initiated and ALWAYS send regardless of the flag.
func isAutoReport(reportType string) bool {
	switch reportType {
	case "crash", "hang", "unhandled_error":
		return true
	}
	return false
}

// fetchDiagnosticsConsent reads users.diagnosticsConsent from the cloud account
// (GET /api/sync/account) using the sidecar's bearer — the same cross-device
// rail the appearance theme_id/icon_id ride. It ONLY governs a signed-in
// client: an empty token is an anonymous client, which defaults to always-on
// (true). Any transport/parse failure, a missing field, or a non-2xx status
// fails OPEN (true): the flag is a deliberate USER opt-out, so a flaky network
// must never silently swallow crash telemetry by defaulting off.
func fetchDiagnosticsConsent(token string) bool {
	if token == "" {
		return true // anonymous → always-on
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cassetteBase+"/api/sync/account", nil)
	if err != nil {
		return true
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return true
	}
	var parsed struct {
		DiagnosticsConsent *bool `json:"diagnosticsConsent"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&parsed); err != nil {
		return true
	}
	if parsed.DiagnosticsConsent == nil {
		return true // field absent → default true
	}
	return *parsed.DiagnosticsConsent
}

// sendReport POSTs one report to the spine. SYNCHRONOUS + best-effort: it blocks
// (short timeout) so a fatal caller can flush before os.Exit; callers that must
// not block (the HTTP recover middleware) invoke it in a goroutine. Any transport
// error is logged and swallowed — a failed report must never affect the app.
func sendReport(r diagnosticsReport) {
	if !diagnosticsEnabled() {
		return
	}
	installID, token := diagnosticsIdentity()
	component := r.Component
	if component == "" {
		component = "sidecar"
	}

	// Consent opt-out (Feature A) gates AUTO reports only, and only for a
	// signed-in client. The stop happens CLIENT-SIDE: when the user has opted
	// out we skip the POST entirely rather than relying on the server to drop
	// it. MANUAL user_feedback is user-initiated and always sends.
	auto := isAutoReport(r.ReportType)
	uploadEnabled := true
	if auto {
		uploadEnabled = fetchDiagnosticsConsent(token)
		if !uploadEnabled {
			log.Printf("diagnostics: %s report suppressed (diagnosticsConsent=false)", r.ReportType)
			return
		}
	}

	body := map[string]interface{}{
		"schema_version":  1,
		"idempotency_key": newUUID(),
		"report_type":     r.ReportType,
		"platform":        "macos-agent",
		"component":       component,
		"app_version":     buildVersion,
		"install_id":      installID,
		"occurred_at":     time.Now().UTC().Format(time.RFC3339),
		"os_name":         "macos",
		"consent": map[string]interface{}{
			// Auto crash/error reports carry user_consented=false (the locked
			// opt-out model); a MANUAL user_feedback report is an explicit user
			// share, so it carries user_consented=true. upload_enabled reflects
			// the RESOLVED opt-out (no longer hardcoded): for auto reports it is
			// the diagnosticsConsent flag (and we already returned above when
			// false), for manual reports it is always true.
			"user_consented": !auto,
			"upload_enabled": uploadEnabled,
			"contains_pii":   false,
			"redacted":       true,
		},
	}
	consent := body["consent"].(map[string]interface{})

	// Feature C: declare the sidecar.log tail as a rolling_trace attachment so
	// the two-step R2 upload runs after the report is accepted. Read once here
	// so the declared byte_size matches exactly what we PUT.
	var logTail []byte
	if r.AttachLogTail {
		if logTail = redactLogTail(readLogTail(256 * 1024)); len(logTail) > 0 {
			// Home paths and secrets are masked, but song and folder names stay
			// in the log, so a report carrying one says it holds personal data
			// (BUG-781).
			consent["contains_pii"] = true
			body["attachments"] = []map[string]interface{}{{
				"slot":         "rolling_trace",
				"kind":         "sidecar.log",
				"content_type": "text/plain",
				"byte_size":    len(logTail),
			}}
		}
	}
	if r.UserMessage != "" {
		body["user_message"] = r.UserMessage
	}
	if v := macOSVersion(); v != "" {
		body["os_version"] = v
	}
	if r.Severity != "" {
		body["severity"] = r.Severity
	}
	if r.Title != "" {
		body["title"] = r.Title
	}
	if r.Fingerprint != "" {
		body["fingerprint"] = r.Fingerprint
	}
	if r.Context != nil {
		body["context"] = r.Context
	}
	if r.CrashSummary != nil {
		body["crash_summary"] = r.CrashSummary
	}

	data, err := json.Marshal(body)
	if err != nil {
		log.Printf("diagnostics: marshal report: %v", err)
		return
	}
	// Own client with a short timeout: this can run on a dying process, and a
	// hung POST must not wedge the exit path.
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, cassetteBase+diagnosticsEndpoint, bytes.NewReader(data))
	if err != nil {
		log.Printf("diagnostics: build request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	// Send auth ONLY if we have it: anonymous-allowed, and a present bearer lets
	// the server stamp the account. An empty "Bearer " header is neither, so omit.
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("diagnostics: report POST failed (non-fatal): %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		// 400 invalid_report / 413 too_large / 429 rate_limited all land here;
		// nothing to retry inline, the durable log already has the detail.
		log.Printf("diagnostics: report rejected: POST %s → %d", diagnosticsEndpoint, resp.StatusCode)
		return
	}
	log.Printf("diagnostics: %s report sent (component=%s)", r.ReportType, component)

	// Feature C: if we declared a log attachment, finish the two-step — PUT the
	// bytes to the presigned R2 URL in the response, then flip the row to
	// 'stored'. Best-effort: a failure here never affects the report we already
	// landed. Skipped when the server returned no presigned URL (no R2 creds).
	if len(logTail) > 0 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		uploadLogAttachment(respBody, installID, logTail)
	}
}

// uploadLogAttachment completes the diagnostics attachment two-step for the
// sidecar.log tail: it reads the presigned rolling_trace PUT URL out of the
// reports response, PUTs the payload straight to R2, then POSTs the
// attachments/complete callback to mark the row 'stored'. Ownership on the
// complete leg is capability-based (echo the report's install_id). Every leg is
// best-effort; a failure is logged and swallowed.
func uploadLogAttachment(reportResp []byte, installID string, payload []byte) {
	var parsed struct {
		ID                string `json:"id"`
		AttachmentUploads []struct {
			Slot         string `json:"slot"`
			PresignedURL string `json:"presignedUrl"`
		} `json:"attachmentUploads"`
	}
	if err := json.Unmarshal(reportResp, &parsed); err != nil || parsed.ID == "" {
		return
	}
	var putURL string
	for _, u := range parsed.AttachmentUploads {
		if u.Slot == "rolling_trace" {
			putURL = u.PresignedURL
			break
		}
	}
	if putURL == "" {
		// No presigned URL: the server has no R2 credentials (report still
		// stored inline). Nothing to upload.
		return
	}

	// Leg 2: PUT the bytes direct to R2 with the declared content type.
	putReq, err := http.NewRequestWithContext(context.Background(), http.MethodPut, putURL, bytes.NewReader(payload))
	if err != nil {
		return
	}
	putReq.Header.Set("Content-Type", "text/plain")
	client := &http.Client{Timeout: 15 * time.Second}
	putResp, err := client.Do(putReq)
	if err != nil {
		log.Printf("diagnostics: log-attachment PUT failed (non-fatal): %v", err)
		return
	}
	putResp.Body.Close()
	if putResp.StatusCode >= 300 {
		log.Printf("diagnostics: log-attachment PUT rejected: %d", putResp.StatusCode)
		return
	}

	// Leg 3: flip the attachment row pending → stored.
	completeBody, _ := json.Marshal(map[string]interface{}{
		"install_id": installID,
		"slot":       "rolling_trace",
		"byte_size":  len(payload),
	})
	completeURL := fmt.Sprintf("%s/api/diagnostics/reports/%s/attachments/complete", cassetteBase, parsed.ID)
	cReq, err := http.NewRequestWithContext(context.Background(), http.MethodPost, completeURL, bytes.NewReader(completeBody))
	if err != nil {
		return
	}
	cReq.Header.Set("Content-Type", "application/json")
	cResp, err := client.Do(cReq)
	if err != nil {
		log.Printf("diagnostics: log-attachment complete failed (non-fatal): %v", err)
		return
	}
	defer cResp.Body.Close()
	if cResp.StatusCode >= 300 {
		log.Printf("diagnostics: log-attachment complete rejected: %d", cResp.StatusCode)
		return
	}
	log.Printf("diagnostics: attached sidecar.log tail (%d bytes) to report %s", len(payload), parsed.ID)
}

// logTailPath is the durable sidecar.log location (SIDECAR_DATA_DIR/sidecar.log),
// matching setupDurableLog in main.go. Empty when no data dir is configured.
func logTailPath() string {
	if sidecarDataDir == "" {
		return ""
	}
	return filepath.Join(sidecarDataDir, "sidecar.log")
}

// readLogTail returns up to maxBytes from the END of sidecar.log — the most
// recent lines, where a crash's cause lives. Best-effort: nil on any error or
// when no log file exists yet.
var (
	logBearerRe = regexp.MustCompile(`(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+`)
	// Subsonic auth (u/t/s/p), API keys and tokens in a URL's query.
	logQuerySecretRe = regexp.MustCompile(`(?i)([?&](?:t|s|p|u|token|apikey|api_key|key|jwt)=)[^&\s"']+`)
	logKeyValueRe    = regexp.MustCompile(`(?i)((?:token|password|secret|apikey|api_key|local_key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}`)
)

// redactLogTail masks what a crash report must never carry off the Mac: the
// person's home folder (their account name is in it) and any token, key or
// password the log caught (BUG-781).
func redactLogTail(data []byte) []byte {
	if len(data) == 0 {
		return data
	}
	if home, err := os.UserHomeDir(); err == nil && len(home) > 1 {
		data = bytes.ReplaceAll(data, []byte(home), []byte("~"))
	}
	data = logBearerRe.ReplaceAll(data, []byte("${1}[redacted]"))
	data = logQuerySecretRe.ReplaceAll(data, []byte("${1}[redacted]"))
	data = logKeyValueRe.ReplaceAll(data, []byte("${1}[redacted]"))
	return data
}

func readLogTail(maxBytes int64) []byte {
	path := logTailPath()
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil
	}
	if fi.Size() > maxBytes {
		if _, err := f.Seek(fi.Size()-maxBytes, io.SeekStart); err != nil {
			return nil
		}
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil
	}
	return data
}

// handleDiagnosticsFeedback is the loopback endpoint the native menu-bar agent
// POSTs a user's free-text "Send Feedback" message to (Feature B). It emits a
// MANUAL report_type=user_feedback report, which ALWAYS sends regardless of the
// diagnosticsConsent opt-out (that flag gates only AUTO crash/error telemetry).
// The master CASSETTE_DIAGNOSTICS=off kill-switch still applies — it disables
// ALL reporting — so we surface that as a distinct, honest response.
func handleDiagnosticsFeedback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var in struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid body"})
		return
	}
	msg := strings.TrimSpace(in.Message)
	if msg == "" {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "empty message"})
		return
	}
	if len(msg) > 8000 {
		msg = msg[:8000] // defensive; the wire body is capped server-side too
	}
	if !diagnosticsEnabled() {
		writePlaybackJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "diagnostics disabled"})
		return
	}
	// Synchronous so the card can confirm to the user; the POST inside
	// sendReport is best-effort (errors logged, not surfaced).
	sendReport(diagnosticsReport{
		ReportType:  "user_feedback",
		Severity:    "info",
		Title:       "User feedback",
		UserMessage: msg,
		Context:     map[string]interface{}{"surface": "menu-bar-agent"},
	})
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// crashSummary builds the small "head" the contract wants for crash_summary: the
// exception-equivalent name/message plus the top ~20 frames of the Go stack. The
// FULL trace is already durable in sidecar.log — this stays small so the report
// body clears the 64KB context ceiling with room to spare.
func crashSummary(message string, stack []byte) map[string]interface{} {
	lines := strings.Split(strings.TrimRight(string(stack), "\n"), "\n")
	// A Go frame is ~2 lines (func + file:line), so ~40 lines ≈ 20 frames.
	if len(lines) > 40 {
		lines = lines[:40]
	}
	return map[string]interface{}{
		"name":    "panic",
		"message": message,
		"frames":  lines,
	}
}

// panicFingerprint groups panics by the first in-repo stack frame, so the same
// bug from different requests collapses to one issue on the spine.
func panicFingerprint(stack []byte) string {
	for _, line := range strings.Split(string(stack), "\n") {
		if l := strings.TrimSpace(line); strings.HasPrefix(l, "github.com/cassette/") {
			return l
		}
	}
	return ""
}

// recoverMiddleware wraps the whole mux: it recovers a panicking handler, logs
// the stack durably, reports it to the spine as unhandled_error, and returns a
// clean 500. net/http already recovers per-connection (silently dropping the
// response); this adds the durable log + report + a real error body. It does NOT
// catch log.Fatal / os.Exit — those are not panics.
func recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			// http.ErrAbortHandler is the sanctioned "abort quietly" panic; log
			// nothing and let net/http do its thing.
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			stack := debug.Stack()
			log.Printf("PANIC in %s %s: %v\n%s", r.Method, r.URL.Path, rec, stack)

			if diagnosticsEnabled() {
				msg := fmt.Sprintf("%v", rec)
				report := diagnosticsReport{
					ReportType:   "unhandled_error",
					Severity:     "error",
					Title:        "panic: " + msg,
					Fingerprint:  panicFingerprint(stack),
					Context:      map[string]interface{}{"path": r.URL.Path, "method": r.Method},
					CrashSummary: crashSummary(msg, stack),
				}
				// Non-blocking: request handling must not wait on the network.
				go sendReport(report)
			}

			// Best-effort clean 500. If the handler already wrote headers this is a
			// no-op superfluous-write (harmless), but usually the panic preceded any
			// write and the caller gets a real error instead of a reset socket.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"internal_error"}`))
		}()
		next.ServeHTTP(w, r)
	})
}

// superviseFatal reports a supervisor crash to the spine (blocking briefly so it
// flushes before exit) then terminates like log.Fatal. Used for the fatal
// Navidrome-startup paths that drive the .app crash loop — the same paths whose
// navidrome.log evidence now survives. It does NOT change the exit behaviour; it
// only adds a durable, remote signal that the loop is happening.
func superviseFatal(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	sendReport(diagnosticsReport{
		ReportType: "crash",
		Component:  "supervisor",
		Severity:   "fatal",
		Title:      msg,
		Context:    map[string]interface{}{"phase": "navidrome-startup"},
		// Attach the sidecar.log tail: this fatal path IS the .app crash loop,
		// and its cause lives in the recent log lines (Feature C). Screenshots
		// are not meaningful for a headless sidecar.
		AttachLogTail: true,
	})
	log.Fatal(msg)
}
