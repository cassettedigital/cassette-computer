// Local HTTP server bound to 127.0.0.1:SIDECAR_PORT (default 5173).
//
// Before pairing: serves the first-run wizard at `/` and the OAuth
// callback at `/callback`.
//
// After pairing: serves a status page at `/` showing live resolver
// progress, and a JSON snapshot at `/status.json` for the page's
// polling JS.
//
// The server is bound to 127.0.0.1 in docker-compose (see ports stanza
// in apps/cassette-player/docker-compose.yml) so no auth is needed.
//
// Concurrency: the resolver mutates SidecarState in place from a
// background goroutine. To avoid races on the big MBIDResolutionState
// map, we publish a small immutable statusSnapshot via atomic.Pointer
// from saveState. HTTP handlers read only the snapshot.

package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sync/atomic"
	"time"
)

// statusSnapshot is the immutable view HTTP handlers consume. It's a
// value-type subset of SidecarState plus the stats — never shares
// mutable structure with the live state.
type statusSnapshot struct {
	Paired            bool                `json:"paired"`
	SubsonicUsername  string              `json:"subsonicUsername,omitempty"`
	PairedAt          time.Time           `json:"pairedAt,omitempty"`
	LastLibrarySyncAt time.Time           `json:"lastLibrarySyncAt,omitempty"`
	Stats             MBIDResolutionStats `json:"mbidStats"`
	Ingest            ingestProgress      `json:"ingest"` // J1 instant-ingest progress (overlaid live)
}

// currentSnapshot is the latest published view of sidecar state.
// nil until publishStatusSnapshot has run at least once.
var currentSnapshot atomic.Pointer[statusSnapshot]

// publishStatusSnapshot builds a snapshot from state and stores it
// atomically. Called from saveState so every persistent state change
// updates the view HTTP handlers see.
func publishStatusSnapshot(state *SidecarState) {
	if state == nil {
		return
	}
	snap := &statusSnapshot{
		Paired:            state.BearerToken != "",
		SubsonicUsername:  state.SubsonicUsername,
		PairedAt:          state.PairedAt,
		LastLibrarySyncAt: state.LastLibrarySyncAt,
		Stats:             state.MBIDResolutionStats,
	}
	currentSnapshot.Store(snap)
}

// pairingHandler signals completion of an OAuth callback. The pairing
// goroutine in main() consumes from this channel.
type pairingHandler struct {
	authURL    string
	state      string // this process's one-time pairing code; the cloud hands it back (BUG-776)
	results    chan<- pairingResult
	registered atomic.Bool
}

// newPairingState mints the one-time code the wizard's sign-in link carries out
// and the cloud echoes back beside the token.
func newPairingState() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "" // no code means no wizard pairing; the app's key still works
	}
	return hex.EncodeToString(b)
}

// trusted reports whether a /callback came from this computer's own pairing.
// Anything else is a token somebody else minted (BUG-776). When the app started
// this hub (its launch key is set), only the key counts: the app signs the hub in
// itself, so the wizard's code is never needed, and a page that managed to read
// the code gets nowhere with it (BUG-857). A hub run without the app accepts the
// wizard's round trip bringing its code back.
func (h *pairingHandler) trusted(r *http.Request) bool {
	if localKey != "" {
		return fromApp(r)
	}
	got := r.URL.Query().Get("state")
	return h.state != "" && subtle.ConstantTimeCompare([]byte(got), []byte(h.state)) == 1
}

// alreadyPaired reads the saved pairing, not just this process's memory, so a
// restarted hub can't be signed into another account (BUG-776).
func (h *pairingHandler) alreadyPaired() bool {
	if h.registered.Load() {
		return true
	}
	snap := currentSnapshot.Load()
	return snap != nil && snap.Paired
}

// pairingHandler.serveCallback is the /callback HTTP handler. It
// performs the same registration steps as the old runPairingFlow inline
// handler, then signals via results.
//
// Once paired (this run or a saved pairing from an earlier one), only the app
// itself can change it: a stale browser tab reopening the URL, or a web page,
// changes nothing. Before that it accepts the app's own sign-in or the
// wizard's own round trip. The app re-signing in (after Sign out, or as
// another account) swaps the saved sign-in and restarts the hub to pick it up.
func (h *pairingHandler) serveCallback(w http.ResponseWriter, r *http.Request) {
	if !hostAllowed(r.Host) {
		http.Error(w, "host not allowed", http.StatusForbidden)
		return
	}
	app := fromApp(r)
	relink := h.alreadyPaired()
	if relink && !app {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, successHTML)
		return
	}
	if relink {
		// The sign-in this hub runs on is the one in memory (the file has none when the app started it, onDisk).
		if liveState != nil && liveState.BearerToken == r.URL.Query().Get("token") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, successHTML) // the sign-in the hub already holds
			return
		}
	}
	if !h.trusted(r) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, failureHTML("This sign-in didn't start on this computer. Open Cassette and sign in from there."))
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, failureHTML("No token received from Cassette. Please try pairing again."))
		select {
		case h.results <- pairingResult{err: fmt.Errorf("callback received without token")}:
		default:
		}
		return
	}

	log.Println("Bearer token received.")

	if navidromeAdmin == "" {
		msg := "NAVIDROME_ADMIN_PW is not set. Add it to docker-compose.yml to enable auto-pairing."
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, failureHTML(msg))
		select {
		case h.results <- pairingResult{err: fmt.Errorf("%s", msg)}:
		default:
		}
		return
	}

	// Sign this computer in as the account's main one. Another computer may already be (BUG-862): then
	// this one keeps the sign-in as a spare, reporting nothing, and its desk asks whether to bring the
	// music here (satellite.go).
	username, err := registerThisComputer(token)
	var another *anotherMainError
	if errors.As(err, &another) {
		log.Printf("Signed in as a second computer: %s", another.Message)
		notMainName.Store(another.Main)
		username, err = "", nil
	}
	if err != nil {
		msg := err.Error()
		log.Printf("Pairing error: %s", msg)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, failureHTML(msg))
		select {
		case h.results <- pairingResult{err: err}:
		default:
		}
		return
	}

	newState := &SidecarState{
		BearerToken:      token,
		SubsonicUsername: username,
		PairedAt:         time.Now(),
	}

	if relink {
		// Everything running holds the old sign-in, so save the new one over it
		// and exit; the app's watchdog starts the hub again on the new account and
		// hands it the new sign-in (a hub the app started keeps none on disk).
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, successHTML)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		h.registered.Store(true)
		go func() {
			time.Sleep(300 * time.Millisecond) // let the reply reach the app
			saved, err := loadState()
			if err != nil {
				saved = &SidecarState{}
			}
			saved.BearerToken, saved.SubsonicUsername, saved.PairedAt = token, username, newState.PairedAt
			if name := notMain(); name != "" {
				if saved.Satellite == nil {
					saved.Satellite = &satelliteState{}
				}
				saved.Satellite.Main = name
			}
			if err := saveState(saved); err != nil {
				log.Printf("Pairing error: could not save the new sign-in: %v", err)
				return
			}
			log.Println("Signed in again from the app; restarting the hub on the new sign-in.")
			// The music server goes with it, as on a satellite's restart (restartHub): left running it holds the
			// port, and the next start talks to it as if it were new (BUG-916). Inside the app the shell cleared it
			// anyway; a hub started by hand (run-native.sh, Docker) had nothing to.
			killSupervisedNavidrome()
			os.Exit(0)
		}()
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, successHTML)
	h.registered.Store(true)
	select {
	case h.results <- pairingResult{state: newState}:
	default:
	}
}

// startLocalServer launches the persistent :5173 server. Returns the
// running *http.Server so main() can stash it (we never actually close
// it; the process exits with the container).
func startLocalServer(addr, authURL string, pairing *pairingHandler) *http.Server {
	mux := newLocalMux(authURL, pairing)
	// Background play-logging: watch the engine's state and log to /api/sync/plays
	// at the scrobble threshold (the Mac renders, so the Mac logs — Principle 2).
	startPlayLogger()

	// recoverMiddleware wraps EVERY route: net/http already recovers each
	// connection's panic, but silently — this adds a durable stack log + a
	// diagnostics-spine report + a clean 500, so a handler panic leaves evidence
	// instead of a reset socket. (It does NOT catch log.Fatal/os.Exit paths.)
	srv := &http.Server{Addr: addr, Handler: recoverMiddleware(mux)}
	// Job 1: serveLocal serves trusted HTTPS + plain HTTP on the same port when
	// a cert is present (dashboard over HTTPS; pairing callback / wizard /
	// :5173 station over plain HTTP, unchanged), or plain HTTP only otherwise.
	go serveLocal(srv, addr)
	return srv
}

// newLocalMux registers every route the :5173 server answers.
//
// Routes:
//
//	GET /             — wizard when unpaired, status page when paired
//	GET /callback     — OAuth callback (one-shot via pairingHandler)
//	GET /status.json  — JSON snapshot for the status page's poller
//
// The three pages a browser navigates to (/, /status.json, /rip) need no CORS,
// but they still check the Host like every other route: a DNS-rebinding page
// could otherwise read them, and the first-run page carries the sign-in code
// (BUG-857).
func newLocalMux(authURL string, pairing *pairingHandler) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/", hostOnly(func(w http.ResponseWriter, r *http.Request) {
		snap := currentSnapshot.Load()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if snap == nil || !snap.Paired {
			fmt.Fprint(w, wizardHTML(authURL))
			return
		}
		fmt.Fprint(w, statusHTML(snap))
	}))

	mux.HandleFunc("/callback", pairing.serveCallback)

	// ── Rip surface (Chunk 4) — pairing-independent ──────────────────────────
	// The /api/rip/* endpoints are called cross-origin by the hosted dashboard
	// (Job 2), so they're wrapped in corsMiddleware (restricted allowlist +
	// same-origin). The /rip HTML station is a navigated page, not a fetch
	// target, so it needs no CORS.
	mux.HandleFunc("/rip", hostOnly(handleRipPage))
	// BUG-188: every rip endpoint that changes state is POST-only (postOnly, see
	// http-guards.go), so a no-Origin GET minted by any web page (<img src=...>)
	// can never start, stop, confirm, rename, retry, reset or eject. The two
	// reads (status.json, contributions) stay GET.
	mux.HandleFunc("/api/rip/status.json", corsMiddleware(handleRipStatus))
	mux.HandleFunc("/api/rip/detect", corsMiddleware(postOnly(handleRipDetect)))
	mux.HandleFunc("/api/rip/start", corsMiddleware(mainOnly(postOnly(handleRipStart))))
	// /api/rip/confirm — the user picked a release from the "confirm" pick-list
	// (POST {releaseMbid}) or chose to import the disc as unknown
	// (POST {importUnknown:true}). Same cross-origin allowlist as the others.
	mux.HandleFunc("/api/rip/confirm", corsMiddleware(mainOnly(postOnly(handleRipConfirm))))
	// /api/rip/search — free-text album search (MusicBrainz + iTunes) so a disc
	// the resolver is unsure about can be found by hand before import-as-unknown
	// (JOB 4). Selection flows back through /api/rip/confirm.
	mux.HandleFunc("/api/rip/search", corsMiddleware(postOnly(handleRipSearch)))
	// /api/rip/acoustid — the deliberate audio-fingerprint scan ("Figure it
	// out", JOB 3). Reads ~120s of a track, fingerprints it, asks AcoustID.
	// Skips cleanly when no ACOUSTID_API_KEY is set.
	mux.HandleFunc("/api/rip/acoustid", corsMiddleware(postOnly(handleRipAcoustID)))
	// /api/rip/name — inline naming of a just-ripped unknown album (JOB 5d):
	// re-tags the landed FLACs from the user's typed names. Tag-only; Navidrome
	// displays tags, so no file/folder renames.
	mux.HandleFunc("/api/rip/name", corsMiddleware(mainOnly(postOnly(handleRipName))))
	// /api/rip/retry — re-rip a single failed track from the "incomplete" state
	// (A4 — POST {position}). Resume-aware; flips the album to "done" on success.
	mux.HandleFunc("/api/rip/retry", corsMiddleware(mainOnly(postOnly(handleRipRetryTrack))))
	// /api/rip/repair — re-read ONE already-landed track from the inserted disc and
	// replace it in place (a bad/skipping rip), gated by a same-album check and a
	// back-up-then-verify-then-swap so the original is never lost. See rip_repair.go.
	mux.HandleFunc("/api/rip/repair", corsMiddleware(mainOnly(postOnly(handleRipRepairTrack))))
	// /api/rip/stop — cancel the active rip + kill the cd-paranoia process group
	// (J4 — POST). Returns the rip to idle; a no-op when not ripping.
	mux.HandleFunc("/api/rip/stop", corsMiddleware(postOnly(handleRipStop)))
	// /api/rip/dismiss-interrupted — acknowledge the "a previous rip didn't finish"
	// notice (POST). Clears the notice + the on-disk marker.
	mux.HandleFunc("/api/rip/dismiss-interrupted", corsMiddleware(postOnly(handleDismissInterrupted)))
	// /api/rip/contributions — export the LOCAL candidate-contribution dataset
	// (JOB 5) for review. ?format=csv for CSV, else JSON. Read-only; nothing is
	// ever submitted externally from the sidecar.
	mux.HandleFunc("/api/rip/contributions", corsMiddleware(handleRipContributions))
	// /api/rip/reset — disc-disappeared signal from the native Disk Arbitration
	// watcher (Job 3). CORS-wrapped for uniformity; the native Go client sends
	// no Origin and passes through.
	mux.HandleFunc("/api/rip/reset", corsMiddleware(mainOnly(postOnly(handleRipReset))))
	// /api/rip/eject — open the drive / spit the disc out via `drutil tray eject`
	// (POST), so a user is never reliant on Finder or a dead physical button.
	// Refused while a rip is active; a no-op when there's no disc.
	mux.HandleFunc("/api/rip/eject", corsMiddleware(postOnly(handleEject)))

	// ── Native playback (Native Playback — The Real Player, SPEC §6) ─────────
	// The web remote POSTs an ordered queue + transport verbs; the broker resolves
	// stream URLs and forwards to the Swift engine (playback.go). GET state is the
	// poll the web's transport bar reads. Same cross-origin allowlist as the rip
	// routes (www/apex/localhost); the native Go client sends no Origin.
	mux.HandleFunc("/api/playback/play", corsMiddleware(handlePlaybackPlay))
	mux.HandleFunc("/api/playback/queue", corsMiddleware(handlePlaybackQueue))
	mux.HandleFunc("/api/playback/pause", corsMiddleware(handlePlaybackPause))
	mux.HandleFunc("/api/playback/resume", corsMiddleware(handlePlaybackResume))
	mux.HandleFunc("/api/playback/next", corsMiddleware(handlePlaybackNext))
	mux.HandleFunc("/api/playback/prev", corsMiddleware(handlePlaybackPrev))
	mux.HandleFunc("/api/playback/seek", corsMiddleware(handlePlaybackSeek))
	mux.HandleFunc("/api/playback/repeat", corsMiddleware(handlePlaybackRepeat))
	mux.HandleFunc("/api/playback/volume", corsMiddleware(handlePlaybackVolume))
	mux.HandleFunc("/api/playback/state", corsMiddleware(handlePlaybackState))
	// Cover art: the single hub for now-playing art (Swift card, Control Center,
	// web bar). Proxies the local Navidrome's getCoverArt with admin creds so the
	// browser never touches :4533 directly. Same cross-origin allowlist as above;
	// a plain <img> sends no Origin and passes through.
	mux.HandleFunc("/api/playback/cover", corsMiddleware(handlePlaybackCover))
	// Visualizer feed (playback-levels.go): a live spectrum/waveform frame proxied
	// from the Swift audio tap, and the cover's dominant palette computed from the
	// same getCoverArt bytes. Same cross-origin allowlist as the routes above.
	mux.HandleFunc("/api/playback/levels", corsMiddleware(handlePlaybackLevels))
	mux.HandleFunc("/api/playback/palette", corsMiddleware(handlePlaybackPalette))

	// Library destructive actions: move audio files to the macOS Trash (recoverable
	// in Finder). HARD RULE: never permanently deletes — trashFile() uses Foundation
	// NSFileManager trashItemAtURL: exclusively. Returns per-track success/failure.
	mux.HandleFunc("/api/library/trash", corsMiddleware(mainOnly(handleLibraryTrash)))
	mux.HandleFunc("/api/library/ingest", corsMiddleware(mainOnly(handleLibraryIngest)))
	// On-demand scan-first convergence (B2 phone pull-to-refresh, C2 desktop Sync
	// Now): blocks until the disk re-read + full sync completes, so the caller can
	// re-report inventory against current truth.
	mux.HandleFunc("/api/library/converge", corsMiddleware(mainOnly(handleLibraryConverge)))
	mux.HandleFunc("/api/library/upload", corsMiddleware(mainOnly(handleLibraryUpload)))
	// Explicit "replace this album's cover" — the one path allowed to
	// overwrite an existing cover.* (see replaceFolderCover, cover-art.go).
	mux.HandleFunc("/api/library/cover/replace", corsMiddleware(mainOnly(handleLibraryCoverReplace)))
	// Explicit "replace this artist's local photo" — same contract, one
	// folder level up (see replaceArtistFolderPhoto, cover-art.go).
	mux.HandleFunc("/api/library/artist-photo/replace", corsMiddleware(mainOnly(handleLibraryArtistPhotoReplace)))
	mux.HandleFunc("/api/library/artist-photo", corsMiddleware(handleLibraryArtistPhoto))
	// "This Mac" dashboard surface: GET /info reports the library folder, its
	// on-disk footprint (cached walk), and the build version; POST /reveal opens
	// that folder in Finder. Same cross-origin allowlist as the routes above.
	mux.HandleFunc("/api/library/info", corsMiddleware(handleLibraryInfo))
	mux.HandleFunc("/api/library/reveal", corsMiddleware(handleLibraryReveal))

	// Menu-bar card quick actions: favorite + add-to-playlist. Thin wrappers over
	// the CLOUD sync API (the web dashboard's store), reusing the bearer token +
	// cassette_local_id the sidecar already has. The {id} wildcard needs go 1.22+
	// ServeMux (go.mod is 1.25).
	mux.HandleFunc("/api/playback/favorite", corsMiddleware(handleCardFavorite))
	mux.HandleFunc("/api/playback/playlists", corsMiddleware(handleCardPlaylists))
	mux.HandleFunc("/api/playback/playlists/{id}/add", corsMiddleware(handleCardPlaylistAdd))
	// In-flight sync count for the desktop shell's "still syncing" quit prompt.
	mux.HandleFunc("/api/sync/pending", corsMiddleware(handleSyncPending))

	// Corded devices (usb.go): what's plugged in right now (for the Pair pane),
	// per-device live status, and the three person-driven actions. Add is the
	// ONLY way a volume becomes a sync target; the watcher never adds on its own.
	mux.HandleFunc("/api/usb/volumes", corsMiddleware(handleUsbVolumes))
	mux.HandleFunc("/api/usb/status", corsMiddleware(handleUsbStatus))
	mux.HandleFunc("/api/usb/add", corsMiddleware(mainOnly(postOnly(handleUsbAdd))))
	mux.HandleFunc("/api/usb/pause", corsMiddleware(postOnly(handleUsbPause)))
	mux.HandleFunc("/api/usb/forget", corsMiddleware(postOnly(handleUsbForget)))
	// Menu-bar "Send Feedback": the native agent POSTs the user's free-text
	// message here and the sidecar emits a MANUAL report_type=user_feedback
	// report to the diagnostics spine (Feature B). Loopback-only via the same
	// CORS allowlist as the card actions.
	// ── This computer's part in the account (satellite.go, BUG-862) ─────────
	// What it is (main, satellite, or a spare holding nothing), "Bring my music here", "Keep <main> as
	// main", and the switch screen's counts and switch. Called by the desk like the doors above.
	mux.HandleFunc("/api/satellite/status", corsMiddleware(handleSatelliteStatus))
	mux.HandleFunc("/api/satellite/join", corsMiddleware(postOnly(handleSatelliteJoin)))
	mux.HandleFunc("/api/satellite/keep-main", corsMiddleware(postOnly(handleSatelliteKeepMain)))
	mux.HandleFunc("/api/satellite/preview", corsMiddleware(postOnly(handleSatellitePreview)))
	mux.HandleFunc("/api/satellite/make-main", corsMiddleware(postOnly(handleSatelliteMakeMain)))

	mux.HandleFunc("/api/diagnostics/feedback", corsMiddleware(handleDiagnosticsFeedback))

	mux.HandleFunc("/status.json", hostOnly(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		snap := currentSnapshot.Load()
		view := statusSnapshot{}
		if snap != nil {
			view = *snap
		}
		view.Ingest = ingestSnapshot() // live — ingest progress updates outside saveState
		_ = json.NewEncoder(w).Encode(view)
	}))

	return mux
}

// buildAuthURL composes the cassette.digital OAuth URL the wizard links to.
// Pulled out so both main() and the wizard renderer use the same shape.
func buildAuthURL(state string) string {
	redirectURI := fmt.Sprintf("http://localhost:%s/callback", sidecarPort)
	return fmt.Sprintf(
		"%s/auth/player?redirect_uri=%s&client=cassette-player&state=%s",
		cassetteBase,
		url.QueryEscape(redirectURI),
		url.QueryEscape(state),
	)
}

// ─── Status HTML ──────────────────────────────────────────────────────────

// statusHTML renders the post-pairing status page. The initial render
// embeds the latest stats; a small JS poller hits /status.json every 5
// seconds for live updates without a full reload.
func statusHTML(snap *statusSnapshot) string {
	stats := snap.Stats
	resolvedPct := 0
	if stats.TotalFilesSeen > 0 {
		resolvedPct = (stats.ResolvedWithMBID * 100) / stats.TotalFilesSeen
	}
	lastPass := "never"
	if !stats.LastPassAt.IsZero() {
		lastPass = stats.LastPassAt.Format("2006-01-02 15:04:05 MST")
	}
	lastSync := "never"
	if !snap.LastLibrarySyncAt.IsZero() {
		lastSync = snap.LastLibrarySyncAt.Format("2006-01-02 15:04:05 MST")
	}
	username := snap.SubsonicUsername
	if username == "" {
		username = "(unknown)"
	}
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cassette Player — Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a0a; color: #ededed;
      min-height: 100vh; padding: 2rem; line-height: 1.5;
    }
    .wrap { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
    .sub { color: #888; font-size: 0.9rem; margin-bottom: 2rem; }
    .panel {
      background: #141414; border: 1px solid #222; border-radius: 8px;
      padding: 1.25rem 1.5rem; margin-bottom: 1rem;
    }
    .panel h2 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase;
                letter-spacing: 0.08em; color: #888; margin-bottom: 0.75rem; }
    .row { display: flex; justify-content: space-between; padding: 0.35rem 0;
           border-bottom: 1px solid #1a1a1a; font-size: 0.95rem; }
    .row:last-child { border-bottom: none; }
    .row .k { color: #999; }
    .row .v { color: #ededed; font-variant-numeric: tabular-nums; }
    .bar { background: #1a1a1a; height: 10px; border-radius: 5px;
           overflow: hidden; margin-top: 0.5rem; }
    .bar > span { display: block; height: 100%; background: #e8500a;
                  transition: width 0.4s ease; }
    .pct { font-size: 1.6rem; font-weight: 600; }
    .note { color: #555; font-size: 0.8rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Cassette Player</h1>
    <p class="sub">paired as <strong id="user">` + escapeHTML(username) + `</strong></p>

    <div class="panel">
      <h2>Library catalogue progress</h2>
      <div class="pct"><span id="resolved">` + fmt.Sprintf("%d", stats.ResolvedWithMBID) + `</span> / <span id="total">` + fmt.Sprintf("%d", stats.TotalFilesSeen) + `</span> tracks <span id="pct">(` + fmt.Sprintf("%d", resolvedPct) + `%)</span></div>
      <div class="bar"><span id="barfill" style="width: ` + fmt.Sprintf("%d", resolvedPct) + `%"></span></div>
      <div class="row"><span class="k">No MusicBrainz match (cached)</span><span class="v" id="nomatch">` + fmt.Sprintf("%d", stats.NoMatchCached) + `</span></div>
      <div class="row"><span class="k">Insufficient tags</span><span class="v" id="insufficient">` + fmt.Sprintf("%d", stats.InsufficientTags) + `</span></div>
      <div class="row"><span class="k">Pending retry</span><span class="v" id="pending">` + fmt.Sprintf("%d", stats.PendingRetry) + `</span></div>
    </div>

    <div class="panel">
      <h2>Last resolver pass</h2>
      <div class="row"><span class="k">When</span><span class="v" id="lastpass">` + lastPass + `</span></div>
      <div class="row"><span class="k">MusicBrainz queries used</span><span class="v" id="lastq">` + fmt.Sprintf("%d", stats.LastPassQueries) + `</span></div>
      <div class="row"><span class="k">Duration</span><span class="v" id="lastdur">` + escapeHTML(stats.LastPassDuration) + `</span></div>
    </div>

    <div class="panel">
      <h2>Library sync</h2>
      <div class="row"><span class="k">Last sync to cassette.digital</span><span class="v" id="lastsync">` + lastSync + `</span></div>
    </div>

    <p class="note">This page polls /status.json every 5 seconds. Local-only — no auth, bound to 127.0.0.1.</p>
  </div>

  <script>
    async function refresh() {
      try {
        const r = await fetch('/status.json', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        const s = d.mbidStats || {};
        const total = s.totalFilesSeen || 0;
        const resolved = s.resolvedWithMbid || 0;
        const pct = total > 0 ? Math.floor((resolved * 100) / total) : 0;
        document.getElementById('total').textContent = total;
        document.getElementById('resolved').textContent = resolved;
        document.getElementById('pct').textContent = '(' + pct + '%)';
        document.getElementById('barfill').style.width = pct + '%';
        document.getElementById('nomatch').textContent = s.noMatchCached || 0;
        document.getElementById('insufficient').textContent = s.insufficientTags || 0;
        document.getElementById('pending').textContent = s.pendingRetry || 0;
        document.getElementById('lastpass').textContent = s.lastPassAt ? new Date(s.lastPassAt).toLocaleString() : 'never';
        document.getElementById('lastq').textContent = s.lastPassQueries || 0;
        document.getElementById('lastdur').textContent = s.lastPassDuration || '';
        document.getElementById('lastsync').textContent = d.lastLibrarySyncAt ? new Date(d.lastLibrarySyncAt).toLocaleString() : 'never';
      } catch (_) { /* swallow; next tick will retry */ }
    }
    setInterval(refresh, 5000);
  </script>
</body>
</html>`
}

// escapeHTML is a tiny replacement for html.EscapeString. We could pull
// in net/html but the values we render (usernames, durations) are tame.
func escapeHTML(s string) string {
	out := make([]byte, 0, len(s))
	for _, b := range []byte(s) {
		switch b {
		case '&':
			out = append(out, []byte("&amp;")...)
		case '<':
			out = append(out, []byte("&lt;")...)
		case '>':
			out = append(out, []byte("&gt;")...)
		case '"':
			out = append(out, []byte("&quot;")...)
		case '\'':
			out = append(out, []byte("&#39;")...)
		default:
			out = append(out, b)
		}
	}
	return string(out)
}
