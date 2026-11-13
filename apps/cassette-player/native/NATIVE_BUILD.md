# Cassette Player — Native build (no Docker) + bundled CD ripper

A single double-click `Cassette Player.app` that runs the Navidrome fork + the
Go sidecar natively (no Docker), and can rip an audio CD straight into the
library. Built in four chunks; each gate was verified **without a disc**.

## Architecture

```
Cassette Player.app
└─ Contents/
   ├─ MacOS/Cassette Player        Swift menu-bar shell (lifecycle + clean Quit)
   ├─ Resources/
   │   ├─ cassette-sidecar         Go supervisor + sidecar + ripper (one binary)
   │   ├─ navidrome                Navidrome fork (WASM taglib; no libtag)
   │   ├─ bin/                     ffmpeg, cd-paranoia, cd-info, flac + dylibs
   │   └─ cassette.env             data/music paths + admin creds
   └─ Info.plist                   LSUIElement (menu-bar agent)
```

Process tree at runtime: **Swift shell → cassette-sidecar (supervisor) → navidrome**.
The Swift shell spawns the sidecar with `CASSETTE_SUPERVISE=1`; the sidecar
spawns Navidrome, waits for `/ping`, opens the UI, runs pairing/heartbeat/
library-sync, and serves the `:5173` wizard/status/**/rip** surface. Quit (menu
or ⌘Q) → Swift SIGTERMs the sidecar → sidecar SIGTERMs Navidrome → clean stop.

## Build

```bash
cd apps/cassette-player
( cd navidrome && make build )                 # Go 1.25+, clang; WASM taglib (no libtag)
( cd sidecar   && go build -o cassette-sidecar . )
./native/setup-data.sh                          # one-time: migrate spine → canonical dirs
./native/build-app.sh                           # assembles + signs "Cassette Player.app"
```

`build-app.sh` compiles the Swift shell, copies both Go binaries, recursively
bundles ffmpeg + the rip CLIs with their dylibs relocated to `@loader_path`
(verified: no `/opt/homebrew` references; runs with a scrubbed environment), and
ad-hoc signs (unsandboxed, this machine only — notarization deferred).

## Run

- **Product:** double-click `Cassette Player.app`. Menu-bar icon → *Open Cassette
  Player* (`:4533`), *Open Pairing & Status* (`:5173`), *Quit*.
- **Terminal/dev:** `./native/run-native.sh` (foreground supervisor; Ctrl-C
  stops both). `./native/stop-native.sh` to stop a detached run.

### Data locations (important — TCC)

A LaunchServices-launched `.app` **cannot read `~/Documents`** without a TCC
"Files & Folders" grant (Navidrome silently fails to open its DB). So the
canonical native data lives in **non-TCC** locations:

| | path |
|---|---|
| data (DB, sidecar.json, caches) | `~/Library/Application Support/Cassette Player` |
| music (rips land here) | `~/Music/Cassette` |

`setup-data.sh` copies the repo spine (`data/navidrome.db`, `sidecar.json`,
music) there once; the original `apps/cassette-player/{data,music}` is left
**untouched as a backup**. `run-native.sh` defaults to the repo dirs but honours
`CASSETTE_DATA_DIR` / `CASSETTE_MUSIC_DIR` to share the canonical library.

## Rip pipeline

`/rip` (on `:5173`) → **Detect disc** → match → **Rip to library**:

```
TOC (cd-paranoia -Q)  → MusicBrainz Disc ID → /ws/2/discid lookup → release + tracklist
  → per track: cd-paranoia -e -w  → flac --best  → flac -t  → write Vorbis tags  → land in music
  → /rest/startScan  → existing sidecar resolver + library-sync (unchanged)
```

Ripped tracks land tagged with their **recording MBIDs**, so they flow through
the existing owned-music path with no MusicBrainz re-lookup. (Catalog enrichment
— Link 3 — is intentionally out of scope: rips appear as bare first-class
albums, as expected.)

## What's verified vs. human-in-the-loop

**Gates passed without a disc:**
- **C1** native cold-start, Docker stopped; library intact; heartbeat reached
  cassette.digital; native `routableHostname()` works without `HOST_HOSTNAME`;
  paired row + bearer token preserved.
- **C2** double-click cold-starts the whole stack (no terminal/Docker); UI
  reachable; Quit stops both processes cleanly; bundled ffmpeg runs isolated.
- **C3** disc-ID computation matches MB ground truth; live `/ws/2/discid` lookup
  → release → per-track mapping; sample WAV → encode → tag → land → **real
  Navidrome scan** shows the album correctly tagged (incl. MBID). The
  cd-paranoia `-Q` parser + the +150 offset convention are validated against MB
  ground truth, so only the literal sector read is unverified.
- **C4** a fixture rip drives the `/rip` UI end-to-end: detect → match (OK
  Computer, 12 tracks) → progress → "Done — 12/12 tracks in your library".

**Left for a human:**
1. **Phone still plays from the native stack** (anytime). The LAN hostname +
   Subsonic creds are unchanged, so the paired phone should connect and play; a
   human must confirm on-device.
2. **Real disc rip** (when a USB optical drive is attached): the one unverified
   seam is **`cd-paranoia` physically reading sectors** (`readTOC` + `ripCDTrack`
   in `sidecar/rip_toc.go` / `rip.go`). On the first real disc, a wrong TOC
   offset would surface immediately as a MusicBrainz "disc not matched" — the
   pipeline self-checks.

**Deferred:** `mpv` is not bundled (jukebox-only, off the streaming/rip path);
notarization (ad-hoc signed for this machine).
