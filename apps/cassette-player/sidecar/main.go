// Cassette Player Sidecar
//
// A small Go binary that runs alongside Navidrome inside the same Docker
// container. It handles:
//
//  1. First-run wizard: opens the user's browser to cassette.digital to
//     sign in, then receives the bearer token via a local HTTP callback.
//  2. Post-auth registration: creates a local Navidrome (Subsonic) user
//     via the Navidrome API, then POSTs to /api/player/register to tell
//     cassette.digital about this player's LAN address + credentials.
//  3. Periodic heartbeat: every 5 minutes, POSTs to /api/player/heartbeat.
//
// The first-run UI is a minimal HTML page served at http://localhost:5173.
// No full settings UI — just enough to complete pairing.
//
// State is persisted to SIDECAR_DATA_DIR/sidecar.json (inside the Docker
// data volume, next to the Navidrome database). The token is stored there
// and survives container restarts.
//
// Environment variables:
//   CASSETTE_API_BASE    — Cassette web URL (default: https://www.cassette.digital,
//                          the canonical host; the apex 307-redirects to it)
//   NAVIDROME_BASE_URL   — Navidrome base URL (default: http://localhost:4533)
//   NAVIDROME_ADMIN_USER — Navidrome admin username (default: admin)
//   NAVIDROME_ADMIN_PW   — Navidrome admin password (set via docker-compose)
//   SIDECAR_DATA_DIR     — Where sidecar.json is stored (default: /data)
//   SIDECAR_PORT         — Port for the first-run wizard UI (default: 5173)

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── Config ──────────────────────────────────────────────────────────────────

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	cassetteBase       = envOr("CASSETTE_API_BASE", "https://www.cassette.digital")
	navidromeBase      = envOr("NAVIDROME_BASE_URL", "http://localhost:4533")
	// CASSETTE_LAN_PORT: where the phones reach this computer over the Wi-Fi (lan-tls.go). Set, the hub answers
	// there and Navidrome listens on loopback only (supervisor.go). Unset (Docker, run-native.sh), Navidrome
	// answers the network itself, as it always did.
	lanPort = envOr("CASSETTE_LAN_PORT", "")
	navidromeAdminUser = envOr("NAVIDROME_ADMIN_USER", "admin")
	navidromeAdmin     = envOr("NAVIDROME_ADMIN_PW", "")
	sidecarDataDir     = envOr("SIDECAR_DATA_DIR", "/data")
	sidecarPort        = envOr("SIDECAR_PORT", "5173")
	sidecarMusicDir    = envOr("SIDECAR_MUSIC_DIR", "/music")
	// Bind address for the local server. Default 127.0.0.1 (fail closed): the
	// rip/library/playback endpoints have no inbound auth, so a wildcard bind would
	// expose destructive actions (trash/rip/eject) to the LAN. Native / .app builds
	// already set 127.0.0.1 explicitly; Docker sets SIDECAR_BIND_ADDR=0.0.0.0 in
	// compose (the container needs the wildcard internally, and the compose port
	// mapping still restricts host exposure to 127.0.0.1).
	sidecarBindAddr = envOr("SIDECAR_BIND_ADDR", "127.0.0.1")
)

// sidecarPortNum is sidecarPort as an int (5173 on parse failure), advertised to
// the cloud (register + heartbeat) so the phone can reach the sidecar's own HTTP
// server — distinct from lanPort (Navidrome :4533) — for on-demand convergence
// (B2 pull-to-refresh → POST /api/library/converge).
func sidecarPortNum() int {
	if n, err := strconv.Atoi(sidecarPort); err == nil && n > 0 && n < 65536 {
		return n
	}
	return 5173
}

// ─── State ───────────────────────────────────────────────────────────────────

type SidecarState struct {
	BearerToken       string    `json:"bearerToken,omitempty"`
	SubsonicUsername  string    `json:"subsonicUsername,omitempty"`
	PairedAt          time.Time `json:"pairedAt,omitempty"`
	LastLibrarySyncAt time.Time `json:"lastLibrarySyncAt,omitempty"`

	// InstallID is an anonymous, client-persistent UUID minted on first run and
	// reused forever. It is the diagnostics spine's correlation + rate-limit key
	// (NOT identity, NOT the account). See diagnostics.go / ensureInstallID.
	InstallID string `json:"installId,omitempty"`

	// ComputerID says which computer this hub is to the cloud's account slot, which only
	// the first computer to send one may hold (BUG-862). See computer-id.go.
	ComputerID string `json:"computerId,omitempty"`

	// Satellite is this computer's part in the account when it isn't the main one: a spare holding
	// nothing, or a satellite receiving the music from the main computer (satellite.go).
	Satellite *satelliteState `json:"satellite,omitempty"`
	// LibraryDir and LibraryData are where this computer's library and its music server's data live
	// when not where the app's settings say: a satellite made the main computer keeps the folder it
	// received (satellite.go, placeLibrary).
	LibraryDir  string `json:"libraryDir,omitempty"`
	LibraryData string `json:"libraryData,omitempty"`

	// LinkedFolders are folders Cassette reads where they are and never writes into (library-folders.go,
	// board #1163). MovingTo is a move of the Cassette folder under way (a retry picks it up); MovedFrom is
	// the old folder a finished move left in place, for the person to put away themselves.
	LinkedFolders []linkedFolder `json:"linkedFolders,omitempty"`
	MovingTo      string         `json:"movingTo,omitempty"`
	MovedFrom     string         `json:"movedFrom,omitempty"`
	// LibraryDrive / LibraryOnDrive name a moved Cassette folder by its drive's serial and its place on it
	// (Windows), so startup can follow it to a new drive letter (placeLibrary).
	LibraryDrive   string `json:"libraryDrive,omitempty"`
	LibraryOnDrive string `json:"libraryOnDrive,omitempty"`

	// MBIDResolutionState caches MusicBrainz lookup outcomes per file so a
	// repeat resolver pass doesn't re-hit the rate-limited public API.
	// Map key is the absolute file path. nil/empty means "never attempted".
	MBIDResolutionState map[string]*MBIDFileState `json:"mbidResolutionState,omitempty"`

	// CoverObservations is the last-seen folder-cover fingerprint per album identity
	// (see cover-fingerprint.go). Used ONLY to decide whether Navidrome must be told
	// to re-hash a folder before we report the change; the wire always carries the
	// CURRENT fingerprint, so losing this map costs one extra rescan, nothing more.
	CoverObservations map[string]coverObservation `json:"coverObservations,omitempty"`

	// CoverFullRehashAt is when every folder cover was last re-read in full. Between
	// full passes a cheap size+mtime gate skips re-reading unchanged covers; this
	// bounds how long that gate is trusted so a mtime-preserving edit is still caught.
	CoverFullRehashAt time.Time `json:"coverFullRehashAt,omitempty"`

	// AudioObservations is the last-seen content fingerprint per track (keyed by
	// CassetteLocalID — see audio-fingerprint.go). Same durability contract as
	// CoverObservations: losing this map costs one extra full re-hash pass,
	// nothing more, since the wire always carries the CURRENT fingerprint.
	AudioObservations map[string]trackObservation `json:"audioObservations,omitempty"`

	// AudioFullRehashAt is retired: each track now remembers when its own file was
	// last read (trackObservation.HashedAtUnix). Kept so older files still load.
	// It was: when every track's file was last re-read in full.
	// Between full passes a cheap size+mtime gate skips re-reading unchanged
	// files; this bounds how long that gate is trusted.
	AudioFullRehashAt time.Time `json:"audioFullRehashAt,omitempty"`

	// MBIDResolutionStats is the aggregate snapshot recomputed at the end
	// of every resolver pass. Surfaced via the local status page and the
	// heartbeat payload to cassette.digital.
	MBIDResolutionStats MBIDResolutionStats `json:"mbidResolutionStats"`

	// UsbDevices is every corded device (USB player, memory card) the person has
	// ADDED, keyed by device id. A volume is only ever a sync target when its
	// marker names an id in here; losing this map makes every card a stranger
	// again, which is the safe direction. See usb.go.
	UsbDevices map[string]*usbDeviceRecord `json:"usbDevices,omitempty"`

	// FolderArtSince is when this hub started watching the library. The automatic
	// cover and artist-photo passes only write into folders created after it, so
	// albums a person already had are never written into (folder-art-forward.go).
	FolderArtSince time.Time `json:"folderArtSince,omitempty"`
}

// onDisk is what of the state goes into sidecar.json. A hub the app started keeps its sign-in in memory only: the
// app holds it in the keychain and hands it over on every start, so a plain-text copy in the data folder (and in
// every backup of it) bought nothing but a token anyone with the file could use (BUG-859). A hub run by hand has
// no app to ask, so it keeps its copy.
func onDisk(s *SidecarState) *SidecarState {
	if localKey == "" || s.BearerToken == "" {
		return s
	}
	cp := *s
	cp.BearerToken = ""
	return &cp
}

// stateMu guards SidecarState's maps against json encoding in saveState. The
// library sync writes them on one goroutine while the USB watcher saves on
// another, and Go aborts the whole process on a map read during a write
// (BUG-788). Every map write takes it for the write itself (short), and
// saveState holds it while encoding and writing, so saves also land in order.
// Lock order: usbMu before stateMu, never the other way.
var stateMu sync.Mutex

func statePath() string {
	return filepath.Join(sidecarDataDir, "sidecar.json")
}

func loadState() (*SidecarState, error) {
	data, err := os.ReadFile(statePath())
	if os.IsNotExist(err) {
		return &SidecarState{}, nil
	}
	if err != nil {
		return nil, err
	}
	var s SidecarState
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	// One-shot Layer 1 → Layer 1.5 migration. Persist immediately so we
	// don't re-run the migration heuristic on every restart.
	if migrateLegacyCacheEntries(&s, time.Now()) {
		if saveErr := saveState(&s); saveErr != nil {
			log.Printf("Warning: could not persist migrated MBID cache: %v", saveErr)
		} else {
			log.Printf("Migrated %d MBID cache entries to Layer 1.5 schema.", len(s.MBIDResolutionState))
		}
	}
	return &s, nil
}

func saveState(s *SidecarState) error {
	stateMu.Lock()
	defer stateMu.Unlock()
	data, err := json.MarshalIndent(onDisk(s), "", "  ")
	if err != nil {
		return err
	}
	// Temp file + rename: a crash or power cut mid-save leaves the previous
	// sidecar.json whole. A torn one used to make the next launch start fresh,
	// signed out with its MusicBrainz memory gone (BUG-788).
	if err := atomicWriteFile(statePath(), data, 0600); err != nil {
		return err
	}
	// Republish the snapshot the local HTTP server's handlers read from.
	// Every persistent state change goes through saveState, so this is
	// the single consistent publish point.
	publishStatusSnapshot(s)
	return nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func randomString(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b)[:n], nil
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "linux":
		cmd = exec.Command("xdg-open", u)
	default:
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Could not open browser automatically: %v", err)
		log.Printf("Please open this URL manually: %s", u)
	}
}

// routableHostname returns the host machine's mDNS-routable hostname and
// whether it is actually LAN-routable. Precedence:
//  1. HOST_HOSTNAME env var — set by dev.sh from `scutil --get LocalHostName`
//     and passed in via docker-compose. Most reliable inside Docker.
//  2. scutil --get LocalHostName — works when the binary runs natively on macOS.
//  3. os.Hostname() — last resort; inside Docker this returns the container ID,
//     which is NOT routable on the LAN. routable=false in that case: callers
//     must never write it to cassette.digital, or /api/player/me hands the
//     phone a hostname it can't reach and every future iOS login breaks.
func routableHostname() (hostname string, routable bool) {
	if h := os.Getenv("HOST_HOSTNAME"); h != "" {
		return h, true
	}
	if runtime.GOOS == "darwin" {
		out, err := exec.Command("scutil", "--get", "LocalHostName").Output()
		if err == nil {
			name := strings.TrimSpace(string(out))
			if name != "" {
				return name + ".local", true
			}
		}
	}
	// Windows: its address on the Wi-Fi (lan-host_windows.go).
	if h, ok := platformLANHost(); ok {
		return h, true
	}
	name, _ := os.Hostname()
	return name, false
}

// ─── Navidrome API ───────────────────────────────────────────────────────────

// navidromeUser is the subset of a Navidrome native /api/user record the
// sidecar reads (listing for reconcile + reaping).
type navidromeUser struct {
	ID       string `json:"id"`
	UserName string `json:"userName"`
	IsAdmin  bool   `json:"isAdmin"`
}

// generateSubsonicCredential mints a fresh random Subsonic username + password.
// It does NOT touch Navidrome — the caller offers it to the cloud, which decides
// whether to enroll it (a first pairing) or hand back the credential it already
// holds (a re-pair). This is why re-pairs no longer churn a new random pair.
func generateSubsonicCredential() (username, password string, err error) {
	suffix, err := randomString(8)
	if err != nil {
		return "", "", err
	}
	password, err = randomString(24)
	if err != nil {
		return "", "", err
	}
	return "cassette-" + strings.ToLower(suffix), password, nil
}

// navidromeAdminLogin authenticates as the admin user and returns a native-API
// JWT. The Subsonic /rest/* user endpoints are stubbed 501 in our build, so all
// user management goes through the native /api/user REST surface with this token.
func navidromeAdminLogin(adminPassword string) (string, error) {
	loginPayload, err := json.Marshal(map[string]string{
		"username": navidromeAdminUser,
		"password": adminPassword,
	})
	if err != nil {
		return "", err
	}
	resp, err := http.Post( //nolint:noctx
		navidromeBase+"/auth/login",
		"application/json",
		bytes.NewReader(loginPayload),
	)
	if err != nil {
		return "", fmt.Errorf("admin login request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read login response: %w", err)
	}
	var result struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decode login response: %w (body: %.200q)", err, body)
	}
	if result.Token == "" {
		return "", fmt.Errorf("admin login returned no token (body: %.200q)", body)
	}
	return result.Token, nil
}

// navidromeListUsers returns all Navidrome users (GET /api/user).
func navidromeListUsers(token string) ([]navidromeUser, error) {
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		navidromeBase+"/api/user?_start=0&_end=1000",
		nil,
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Nd-Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("listUsers request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read listUsers response: %w", err)
	}
	var users []navidromeUser
	if err := json.Unmarshal(body, &users); err != nil {
		return nil, fmt.Errorf("decode listUsers response: %w (body: %.200q)", err, body)
	}
	return users, nil
}

// navidromeCreateUser creates a non-admin Navidrome user with the given username
// + password (POST /api/user) and returns its id. This is the ONLY reliable way
// to *set* a password: Navidrome's Put requires the current password to change
// one, which the sidecar never keeps.
func navidromeCreateUser(token, username, password string) (string, error) {
	// NOTE: never log this payload — it carries the plaintext playback password.
	payload, err := json.Marshal(map[string]interface{}{
		"userName": username,
		"password": password,
		"isAdmin":  false,
		"email":    username + "@cassette.local",
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		navidromeBase+"/api/user",
		bytes.NewReader(payload),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Nd-Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("createUser request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read createUser response: %w", err)
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decode createUser response: %w (body: %.200q)", err, body)
	}
	if result.ID == "" {
		return "", fmt.Errorf("createUser returned no ID (body: %.200q)", body)
	}
	return result.ID, nil
}

// navidromeDeleteUser removes a Navidrome user (DELETE /api/user/{id}).
func navidromeDeleteUser(token, id string) error {
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodDelete,
		navidromeBase+"/api/user/"+id,
		nil,
	)
	if err != nil {
		return err
	}
	req.Header.Set("X-Nd-Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("deleteUser request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("deleteUser %s → %d (%.200q)", id, resp.StatusCode, body)
	}
	return nil
}

// ensureSubsonicUser reconciles Navidrome so that exactly one playback user
// exists with the given username + password, and reaps every OTHER cassette-*
// user left behind by earlier pairings.
//
// Because a password can only be *set* at create time (Navidrome's Put needs the
// current password), we delete any stale copy of the authoritative user and
// recreate it — which also heals historical password drift. Reaping the other
// cassette-* users is best-effort: a failed delete is logged, never fatal, so it
// can never block pairing. The exact authoritative username is preserved (it is
// recreated immediately after), and only OTHER cassette-* users are reported as
// orphans.
func ensureSubsonicUser(adminPassword, username, password string) error {
	token, err := navidromeAdminLogin(adminPassword)
	if err != nil {
		return err
	}
	users, err := navidromeListUsers(token)
	if err != nil {
		return err
	}
	for _, u := range users {
		if !strings.HasPrefix(u.UserName, "cassette-") {
			continue
		}
		if delErr := navidromeDeleteUser(token, u.ID); delErr != nil {
			log.Printf("Warning: could not reap Navidrome user %q: %v", u.UserName, delErr)
		} else if u.UserName != username {
			log.Printf("Reaped orphaned Navidrome playback user: %s", u.UserName)
		}
	}
	if _, err := navidromeCreateUser(token, username, password); err != nil {
		return fmt.Errorf("create playback user %q: %w", username, err)
	}
	log.Printf("Navidrome playback user ready: %s", username)
	return nil
}

// ─── Cassette API ─────────────────────────────────────────────────────────────

func callCassetteAPI(method, path string, token string, body interface{}) error {
	var reqBody *bytes.Buffer
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewBuffer(b)
	} else {
		reqBody = &bytes.Buffer{}
	}

	req, err := http.NewRequestWithContext(
		context.Background(),
		method,
		cassetteBase+path,
		reqBody,
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("cassette API %s %s → %d", method, path, resp.StatusCode)
	}
	return nil
}

// registerWithCassette POSTs the pairing registration and returns the
// AUTHORITATIVE Subsonic credential the sidecar must enforce in Navidrome.
//
// The cloud is the source of truth for the credential. On a FIRST pairing it
// stores (and echoes back) the freshly-minted candidate we send; on a RE-PAIR it
// KEEPS the credential it already holds and returns THAT, so the username +
// password stay stable across re-pairs instead of churning a new random pair
// every time (which re-keyed the phone's account and stranded its downloads).
//
// The response carries the decrypted password — the same trust boundary as
// /api/player/me, which already returns it to the phone under the same bearer
// auth. It is never logged.
func registerWithCassette(token string, body map[string]interface{}) (username, password string, err error) {
	b, err := json.Marshal(body)
	if err != nil {
		return "", "", err
	}
	req, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		cassetteBase+"/api/player/register",
		bytes.NewBuffer(b),
	)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", err
	}
	if resp.StatusCode == http.StatusConflict {
		// Another computer is this account's main one (BUG-862): say so in the cloud's own words.
		var refused struct {
			Error        string `json:"error"`
			MainComputer string `json:"mainComputer"`
			Message      string `json:"message"`
		}
		if json.Unmarshal(respBody, &refused) == nil && refused.Error == "ANOTHER_MAIN_COMPUTER" {
			return "", "", &anotherMainError{Main: refused.MainComputer, Message: refused.Message}
		}
	}
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("cassette API POST /api/player/register → %d (%.200q)", resp.StatusCode, respBody)
	}
	var result struct {
		SubsonicUsername string `json:"subsonicUsername"`
		SubsonicPassword string `json:"subsonicPassword"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", "", fmt.Errorf("decode register response: %w", err)
	}
	if result.SubsonicUsername == "" || result.SubsonicPassword == "" {
		return "", "", fmt.Errorf("register response missing authoritative credential")
	}
	return result.SubsonicUsername, result.SubsonicPassword, nil
}

// anotherMainError is the cloud saying another computer is this account's main one (BUG-862).
type anotherMainError struct{ Main, Message string }

func (e *anotherMainError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return "Another computer is this account's main one."
}

// registerThisComputer signs this computer in as the account's main one: its Wi-Fi address and the phones'
// music-server login, which the cloud keeps (the one it already holds on a second sign-in) and this
// computer's music server is set up to accept. Returns the login's user name, or *anotherMainError.
func registerThisComputer(token string) (string, error) {
	if navidromeAdmin == "" {
		return "", fmt.Errorf("NAVIDROME_ADMIN_PW is not set")
	}
	// A CANDIDATE credential, enrolled in Navidrome only once the cloud says which one stands.
	candidateUser, candidatePassword, err := generateSubsonicCredential()
	if err != nil {
		return "", fmt.Errorf("Could not prepare Subsonic credential: %v", err)
	}
	hostname, routable := routableHostname()
	if !routable {
		// Registering a container ID as lanHostname poisons /api/player/me and breaks every phone's sign-in.
		return "", fmt.Errorf("Refusing to register: no routable LAN hostname (got container fallback %q). "+
			"Start the sidecar via scripts/dev.sh so HOST_HOSTNAME is set, then retry pairing.", hostname)
	}
	log.Printf("Registering with Cassette as %s:%d…", hostname, lanPortNum())
	reg := map[string]interface{}{
		"lanHostname":      hostname,
		"lanPort":          lanPortNum(),
		"sidecarPort":      sidecarPortNum(),
		"subsonicUsername": candidateUser,
		"subsonicPassword": candidatePassword,
		"computerId":       computerID,
	}
	if lanTLSPin != "" {
		reg["lanTlsPin"] = lanTLSPin
	}
	username, password, err := registerWithCassette(token, reg)
	if err != nil {
		var another *anotherMainError
		if errors.As(err, &another) {
			return "", err
		}
		return "", fmt.Errorf("Registration with cassette.digital failed: %v", err)
	}
	log.Printf("Setting up Navidrome playback user: %s", username)
	if err := ensureSubsonicUser(navidromeAdmin, username, password); err != nil {
		return "", fmt.Errorf("Could not set up Navidrome user: %v", err)
	}
	return username, nil
}

// ─── Pairing flow ────────────────────────────────────────────────────────────

// pairingResult is sent by the /callback handler once registration completes
// (or fails). It carries either a ready-to-save state or an error.
type pairingResult struct {
	state *SidecarState
	err   error
}

// waitForPairing blocks until the persistent local server's /callback
// handler signals success. A failed attempt is logged and the wait goes on:
// someone may take an hour to sign in, and exiting used to restart the hub and
// Navidrome every ten minutes until they did (BUG-788). On success it mutates
// state in place and persists.
//
// The server is started once by main() and is never closed — it
// continues to serve the status page after pairing completes.
func waitForPairing(state *SidecarState, results <-chan pairingResult) error {
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Printf("  Open http://localhost:%s in your browser to pair", sidecarPort)
	log.Printf("  Cassette Player with your Cassette account.")
	log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	var result pairingResult
	for {
		result = <-results
		if result.err == nil {
			break
		}
		log.Printf("Pairing attempt failed, still waiting: %v", result.err)
	}

	// Take the sign-in only. Replacing the whole state wiped what this launch had
	// already recorded, such as the install id and when the hub started watching.
	state.BearerToken = result.state.BearerToken
	state.SubsonicUsername = result.state.SubsonicUsername
	state.PairedAt = result.state.PairedAt
	if err := saveState(state); err != nil {
		log.Printf("Warning: could not save state: %v", err)
	}

	log.Println("✓ Cassette Player paired with your Cassette account.")
	log.Println("  Open the Cassette app on your phone — it'll connect automatically.")
	log.Println("  Make sure your phone is on the same Wi-Fi as your computer.")
	return nil
}

// ─── Heartbeat loop ──────────────────────────────────────────────────────────

func heartbeatLoop(state *SidecarState) {
	// One heartbeat tick: build the payload and POST it. Extracted so the loop
	// can fire it immediately on launch (so reopening the sidecar refreshes the
	// dashboard's status right away) and then on every 5-minute tick — rather
	// than leaving the device "offline" for the first 5 minutes after startup.
	// allowSync gates the (heavier) full library sync: the immediate launch beat
	// refreshes STATUS ONLY, so we never fire a full library sync before the
	// library has settled — that stays on the 5-minute tick, as it was before.
	beat := func(allowSync bool) {
		hostname, routable := routableHostname()
		body := map[string]interface{}{
			"lanPort":     lanPortNum(),
			"sidecarPort": sidecarPortNum(),
			"computerId":  computerID,
		}
		if lanTLSPin != "" {
			body["lanTlsPin"] = lanTLSPin
		}
		if routable {
			body["lanHostname"] = hostname
		} else {
			// Never heartbeat a container ID as the LAN hostname — the route
			// treats lanHostname as optional, so omit it and keep whatever
			// good value the server already has. Fail loudly instead.
			log.Printf("WARNING: no routable hostname (HOST_HOSTNAME unset, fallback is container ID %q).", hostname)
			log.Printf("         Omitting lanHostname from heartbeat. Restart the sidecar via scripts/dev.sh.")
		}
		// Only attach mbidStats once the resolver has run at least once
		// (LastPassAt non-zero). Sending an all-zero stats block on
		// startup would clobber a previously-persisted snapshot with
		// stale zeros.
		if !state.MBIDResolutionStats.LastPassAt.IsZero() {
			body["mbidStats"] = state.MBIDResolutionStats
		}
		status, resp, err := cassetteAPI(http.MethodPost, "/api/player/heartbeat", body)
		switch {
		case err != nil:
			log.Printf("Heartbeat failed (will retry): %v", err)
		case status == http.StatusConflict:
			// Another computer is the account's main one (BUG-862): this one reports nothing of its own,
			// and becomes a satellite if the person made it one (satellite.go).
			var refused struct {
				MainComputer string `json:"mainComputer"`
			}
			_ = json.Unmarshal(resp, &refused)
			noteRefusedAsMain(state, refused.MainComputer)
		case status >= 300:
			log.Printf("Heartbeat failed (will retry): HTTP %d", status)
		default:
			noteMain(state)
			log.Printf("Heartbeat sent (hostname=%s)", hostname)
		}
		if allowSync && !asSpare() && shouldRunLibrarySync(state) {
			// B3 (self-healing convergence): route the lazy heartbeat backstop
			// through the SAME scan-first convergence routine the watcher / on-demand
			// asks use (ingestNow via ingestTrigger), so a periodic catch-up also
			// re-reads the disk — completing a deletion even if nothing fired an
			// FS-watch or scan. Non-blocking send coalesces with any in-flight or
			// queued convergence; ingestNow advances LastLibrarySyncAt, so the 1h
			// shouldRunLibrarySync gate keeps holding.
			select {
			case ingestTrigger <- struct{}{}:
			default:
			}
		}
	}

	// Fire once immediately (status only) so launch/reopen refreshes the
	// dashboard without waiting for the first tick; the library sync still runs
	// on the 5-minute tick.
	beat(false)

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		beat(true)
	}
}

// ─── HTML templates ──────────────────────────────────────────────────────────

// wizardHTML is the first-run page. An empty authURL (a hub the app started) has
// no sign-in link of its own: the app signs it in.
func wizardHTML(authURL string) string {
	signIn := `<a class="btn" href="` + authURL + `">Sign in with Cassette</a>`
	note := `<p class="note">This opens cassette.digital in your browser.<br>No passwords are stored by this app.</p>`
	if authURL == "" {
		signIn, note = `<p>Open Cassette and sign in there.</p>`, ""
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cassette Player — First Run</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a; color: #ededed;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 2rem;
    }
    .card {
      max-width: 400px; width: 100%; text-align: center;
    }
    h1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1rem; }
    p { color: #aaa; line-height: 1.65; margin-bottom: 1.5rem; }
    .btn {
      display: inline-block; width: 100%; padding: 0.9rem 1.5rem;
      background: #e8500a; color: #fff; border: none; border-radius: 8px;
      font-size: 1rem; font-weight: 600; cursor: pointer; text-decoration: none;
    }
    .btn:hover { background: #cf4509; }
    .disclosure {
      font-size: 0.85rem; color: #888; line-height: 1.6;
      margin-top: 1.25rem; padding: 0.85rem 1rem;
      background: #141414; border: 1px solid #222; border-radius: 6px;
      text-align: left;
    }
    .note { font-size: 0.8rem; color: #555; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Cassette</h1>
    <p>Sit down at your computer with your phone nearby.<br>
       We'll connect them automatically.<br>
       Your phone needs to be on the same Wi-Fi as your computer for this to work.</p>
    ` + signIn + `
    <p class="disclosure">Cassette adds a MusicBrainz ID to your songs' tags so each one is recognized on every device, and puts a cover picture in album folders you add from now on. Nothing else in your files changes.</p>
    ` + note + `
  </div>
</body>
</html>`
}

const successHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cassette Player — Paired</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #ededed;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { max-width: 400px; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { color: #aaa; line-height: 1.65; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Cassette Player is paired with your Cassette account.</h1>
    <p>Open the Cassette app on your phone — it'll connect automatically.<br>
       Make sure your phone is on the same Wi-Fi network.</p>
    <p style="margin-top:1.5rem;color:#555;font-size:0.85rem;">You can close this window.</p>
  </div>
</body>
</html>`

func failureHTML(reason string) string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cassette Player — Pairing Failed</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #ededed;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { max-width: 400px; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #e8500a; }
    p { color: #aaa; line-height: 1.65; }
    .detail { margin-top: 1rem; padding: 0.75rem 1rem; background: #1a1a1a;
              border-radius: 6px; font-size: 0.85rem; color: #888; text-align: left;
              word-break: break-word; }
    .retry { margin-top: 1.5rem; font-size: 0.85rem; color: #555; }
    a { color: #e8500a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Pairing failed.</h1>
    <p>Something went wrong while connecting Cassette Player to your account.</p>
    <div class="detail">` + reason + `</div>
    <p class="retry">Check the sidecar logs for details, then <a href="/">try again</a>.</p>
  </div>
</body>
</html>`
}

// ─── Main ────────────────────────────────────────────────────────────────────

// setupDurableLog tees the logger to SIDECAR_DATA_DIR/sidecar.log (append-only)
// in addition to stderr. The .app redirects the sidecar's stderr to a
// supervisor.log that it TRUNCATES on every launch — so a relaunch (or the crash
// loop) wipes a failing run's lines. This file lives in a known, persistent data
// dir and survives relaunches, so per-track rip failures are always retrievable.
// Single-generation rotation at ~5MB keeps it bounded while always retaining the
// prior run's tail. Best-effort: on any error we keep stderr-only.
func setupDurableLog() {
	if sidecarDataDir == "" {
		return
	}
	if err := os.MkdirAll(sidecarDataDir, 0o755); err != nil {
		return
	}
	path := filepath.Join(sidecarDataDir, "sidecar.log")
	if fi, err := os.Stat(path); err == nil && fi.Size() > 5*1024*1024 {
		_ = os.Rename(path, path+".1") // keep one prior generation
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
}

// buildVersion is stamped at build time via -ldflags "-X main.buildVersion=…"
// (see native/build-app.sh). It is "dev" for a bare `go build` — which, note,
// produces ./player-sidecar from the module name, NOT the ./cassette-sidecar the
// .app actually bundles and launches. Logged on start AND surfaced in
// /api/rip/status.json so the panel can show which sidecar code is live at a
// glance (the cure for "rebuilt but still running yesterday's binary").
var buildVersion = "dev"

func main() {
	log.SetPrefix("[cassette-sidecar] ")
	log.SetFlags(log.LstdFlags)
	setupDurableLog()

	// A satellite's music server runs over the folder it receives into (satellite.go): decided before
	// anything below uses the music folder.
	placeLibrary()

	// Make sure the library folder exists before Navidrome scans it or a first
	// drop-a-folder import runs. On a clean Windows box the music dir
	// (%USERPROFILE%\Music\Cassette) does not exist until a rip lazily created it,
	// which left "add music" with no destination and Navidrome scanning a missing
	// path. Best-effort: a failure here is logged, not fatal.
	// Only where it belongs already exists: a Cassette folder moved to a drive that's unplugged is
	// left away, never started over on this computer's own disk (library-folders.go).
	if err := makeMusicFolder(sidecarMusicDir); err != nil {
		log.Printf("Warning: could not create music dir %q: %v", sidecarMusicDir, err)
	}

	log.Printf("Starting Cassette Player sidecar… (build %s)", buildVersion)

	// .app mode: become the in-process supervisor (spawn Navidrome, wait for
	// health, open the UI). No-op for Docker / run-native.sh.
	resolveNavidromeAdminPassword()
	if os.Getenv("CASSETTE_SUPERVISE") == "1" {
		startSupervisedNavidrome()
		// The bundled hub owns its Navidrome, so make sure the admin it signs in
		// as exists (a fresh install has none). See admin_setup.go.
		ensureNavidromeAdmin()
		// The phones' way in over the Wi-Fi, now that Navidrome listens on this computer only (lan-tls.go).
		// A satellite never answers the phones (satellite.go).
		if lanPort != "" && !satelliteOn.Load() {
			if err := startLANGateway(lanPort, navidromeBase); err != nil {
				log.Printf("lan-tls: phones can't reach this computer: %v", err)
			}
		}
	}

	state, err := loadState()
	if err != nil {
		log.Printf("Warning: could not load state, starting fresh: %v", err)
		state = &SidecarState{}
	}
	// Expose the live state to the rip path so a finished rip can run an
	// immediate library-sync (Job 1), and clear any temp dirs orphaned by a
	// previous mid-rip crash/quit (Job 4).
	liveState = state
	publishLinkedRoots(state) // before anything below may write into a song (songHeld)
	// placeLibrary followed a moved Cassette folder's drive to a new letter: remember where it is now.
	if state.LibraryDir != "" && !satelliteOn.Load() && filepath.Clean(state.LibraryDir) != filepath.Clean(sidecarMusicDir) {
		log.Printf("folders: the Cassette folder is now at %s (was %s)", sidecarMusicDir, state.LibraryDir)
		state.LibraryDir = sidecarMusicDir
		if err := saveState(state); err != nil {
			log.Printf("Warning: could not save the Cassette folder's new place: %v", err)
		}
	}
	// An older hub wrote the sign-in into sidecar.json; take it out now (onDisk). This launch keeps using it from
	// memory, and the app hands it over again on every start after this one.
	if localKey != "" && state.BearerToken != "" {
		if err := saveState(state); err != nil {
			log.Printf("Warning: could not take the sign-in out of sidecar.json: %v", err)
		}
	}
	ensureInstallID(state)  // anonymous diagnostics correlation key (persists on first mint)
	ensureComputerID(state) // which computer this is to the account's slot (BUG-862)
	if ensureFolderArtBaseline(state) {
		if err := saveState(state); err != nil {
			log.Printf("Warning: could not persist the folder-art start time: %v", err)
		}
	}
	sweepStaleRipTemp()
	detectInterruptedRip() // a leftover rip marker means the last rip was killed mid-flight
	detectSeatedDisc()     // BUG-199: an app restart must not forget a seated disc

	// The opt-in cover backfill (SIDECAR_BACKFILL_COVERS) is retired (BUG-825): it rewrote every folder
	// cover over the size cap, whoever put it there, and deleted the old file. A cover already in a person's
	// folder is never rewritten; screens get their sizes from the image ladder (picture-ladder.go) instead.

	// Artist-photo heal for libraries an OLD build wrote barred photos into. Opt-in
	// only: it used to run by itself on first launch, which on anyone else's Mac
	// could only ever reach their own files (BUG-786).
	if os.Getenv("SIDECAR_REHEAL_ARTIST_PHOTOS") == "1" {
		go func() {
			log.Printf("artist reheal: scan of %s …", sidecarMusicDir)
			seen, healed := rehealArtistPhotos(sidecarMusicDir)
			log.Printf("artist reheal: done — %d artist photos seen, %d rehealed (native aspect)", seen, healed)
		}()
	}

	// Publish the initial snapshot so the /status.json endpoint has
	// something to serve even before the first resolver pass.
	publishStatusSnapshot(state)

	// Start the local HTTP server now — it lives for the rest of the
	// process. Before pairing it serves the wizard at /; after pairing
	// it serves the status page. The OAuth callback signals via results.
	// The wizard's sign-in link carries a one-time code the cloud hands back. A hub
	// the app started is signed in by the app and takes only its key (BUG-857), so
	// it mints no code and its first-run page offers no link that would be refused.
	pairState, authURL := "", ""
	if localKey == "" {
		pairState = newPairingState()
		authURL = buildAuthURL(pairState)
	}
	pairingResults := make(chan pairingResult, 1)
	pairing := &pairingHandler{authURL: authURL, state: pairState, results: pairingResults}
	_ = startLocalServer(fmt.Sprintf("%s:%s", sidecarBindAddr, sidecarPort), authURL, pairing)

	if state.BearerToken == "" {
		log.Println("No Cassette account linked. Starting first-run wizard…")
		if err := waitForPairing(state, pairingResults); err != nil {
			log.Fatalf("Pairing failed: %v", err)
		}
	} else {
		log.Printf("Already paired (user: %s, since: %s). Starting heartbeat…",
			state.SubsonicUsername, state.PairedAt.Format("2006-01-02"))
	}

	// One-time cover remediation (opt-in, dry-run-first). Repairs folders whose
	// cover.jpg was stamped by the pre-guard iTunes fallback (wrong-album art —
	// Petey/USA → "Like a Mantra", etc.). Runs after pairing so the catalog lookup
	// is authenticated. SIDECAR_REMEDIATE_COVERS=1 → DRY-RUN (logs the old→new list,
	// writes nothing — review it first); =execute → writes the catalog cover for the
	// confirmed mismatches. Scoped to no-embedded-art folders; user-swapped covers
	// are preserved. Background, so it never blocks startup.
	if mode := os.Getenv("SIDECAR_REMEDIATE_COVERS"); (mode == "1" || mode == "execute") && !asSpare() {
		execute := mode == "execute"
		go func() {
			modeLabel := "DRY-RUN"
			if execute {
				modeLabel = "EXECUTE"
			}
			log.Printf("cover remediate: scanning %s … (%s)", sidecarMusicDir, modeLabel)
			proposed, replaced, manual := remediateMismatchedCovers(sidecarMusicDir, execute)
			if execute {
				log.Printf("cover remediate: done — %d replaced, %d left for manual review", replaced, manual)
			} else {
				log.Printf("cover remediate: DRY-RUN done — %d would be replaced, %d need manual review "+
					"(set SIDECAR_REMEDIATE_COVERS=execute to apply)", proposed, manual)
			}
		}()
	}

	// A satellite receives the music and does none of the main computer's work: no check-in as the main
	// one, no library report, no watching the folder for drop-ins, no USB players, no rips (satellite.go).
	if satelliteOn.Load() {
		log.Println("Satellite: receiving the music from the main computer…")
		goForever("satellite", func() { satelliteLoop(state) })
		select {}
	}

	// Start heartbeat in background
	log.Println("Starting heartbeat loop (every 5 min)…")
	if !asSpare() && shouldRunLibrarySync(state) {
		log.Println("Starting initial library sync in the background…")
		goSafe("initial library sync", func() { runLibrarySyncAndSave(state, "full") })
	}
	// The long-running loops come back after a panic instead of taking the whole
	// hub down with them (BUG-788). Rips and playback are left to crash: their
	// restart paths (interrupted-rip detection, the app's watchdog) are what
	// clean up after them, and a recovered half-rip would not be.
	goForever("heartbeat", func() { heartbeatLoop(state) })
	goForever("linked folders watcher", func() { linkedWatcher(state) }) // folders Cassette reads (#1163)
	goSafe("linked folders reconcile", func() { reconcileLinkedFolders(state) })
	goForever("ingest watcher", func() { ingestWatcher(state) }) // J1: instant ingest — music-dir watch + POST /api/library/ingest
	// Corded devices: recognise added USB players when they're plugged in and
	// fill them through the phones' intent queue (usb.go). Strangers are only
	// ever listed for the Pair pane, never written to.
	goForever("usb watcher", func() { startUsbWatcher(state) })
	// BUG-256: finish any rip whose post-rip scan was killed before it registered
	// (e.g. the app was quit/updated mid-scan). Delay so the startup sync + watcher
	// settle and Navidrome is listening; then it heals or force-rescans on its own.
	goSafe("rip reconcile", func() {
		time.Sleep(30 * time.Second)
		reconcileUnregisteredRips(state)
	})

	// Block forever (sidecar runs as long as the container runs)
	select {}
}
