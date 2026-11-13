#!/usr/bin/env bash
# Cassette Player — native supervisor (Chunk 1, de-Docker)
#
# Replaces docker-compose: starts Navidrome, waits for /ping healthy, then
# starts the sidecar — pointed at the EXISTING music + data so pairing,
# device registration, and the synced library all survive.
#
# Deliberately does NOT set HOST_HOSTNAME: native routableHostname() resolves
# the LAN name via `scutil --get LocalHostName` directly. The routable-refusal
# logic in the sidecar still holds if that ever returns empty.
#
# Foreground supervisor: Ctrl-C (or `stop-native.sh`) stops both cleanly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # apps/cassette-player
NAVIDROME_BIN="$ROOT/navidrome/navidrome"
SIDECAR_BIN="$ROOT/sidecar/cassette-sidecar"
RUNDIR="$ROOT/native/run"
LOGDIR="$ROOT/native/logs"
mkdir -p "$RUNDIR" "$LOGDIR"

[ -x "$NAVIDROME_BIN" ] || { echo "FATAL: missing $NAVIDROME_BIN (run: cd navidrome && make build)"; exit 1; }
[ -x "$SIDECAR_BIN" ]   || { echo "FATAL: missing $SIDECAR_BIN (run: cd sidecar && go build -o cassette-sidecar .)"; exit 1; }

# Admin creds (NAVIDROME_ADMIN_USER / NAVIDROME_ADMIN_PW) come from .env — never inlined here.
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

FFMPEG="$(command -v ffmpeg || true)"

# Data/music location. Defaults to the in-repo dirs (the Chunk 1 terminal
# runner). To share ONE library with the double-click .app, point these at the
# canonical non-TCC location: CASSETTE_DATA_DIR / CASSETTE_MUSIC_DIR (see
# native/setup-data.sh). The .app MUST use the canonical location (a
# LaunchServices app can't read ~/Documents without a TCC grant); a terminal
# run can use either.
DATA_DIR="${CASSETTE_DATA_DIR:-$ROOT/data}"
MUSIC_DIR="${CASSETTE_MUSIC_DIR:-$ROOT/music}"

# ── Navidrome env (mirrors docker-compose.yml, paths now native) ──────────────
export ND_MUSICFOLDER="$MUSIC_DIR"
export ND_DATAFOLDER="$DATA_DIR"
export ND_PORT="4533"
export ND_SCANNER_SCHEDULE="1h"
export ND_SESSIONTIMEOUT="24h"
export ND_LOGLEVEL="info"
export ND_DEFAULTTHEME="Cassette"
export ND_UIWELCOMEMESSAGE="Welcome to Cassette Player"
# Never reach out to outside services (same switches the sidecar forces,
# sidecar/supervisor.go withoutExternalServices): no metadata agents, no
# ListenBrainz, no usage report, no downloaded login background.
export ND_ENABLEEXTERNALSERVICES="false"
export ND_ENABLEINSIGHTSCOLLECTOR="false"
export ND_AGENTS=""
[ -n "$FFMPEG" ] && export ND_FFMPEGPATH="$FFMPEG"

# ── Sidecar env (NAVIDROME_BASE_URL now localhost; NO HOST_HOSTNAME) ──────────
export CASSETTE_API_BASE="${CASSETTE_API_BASE:-https://cassette.digital}"
export NAVIDROME_BASE_URL="http://localhost:4533"
export NAVIDROME_ADMIN_USER="${NAVIDROME_ADMIN_USER:-cassette}"
export NAVIDROME_ADMIN_PW="${NAVIDROME_ADMIN_PW:-}"
export SIDECAR_DATA_DIR="$DATA_DIR"
export SIDECAR_MUSIC_DIR="$MUSIC_DIR"
export SIDECAR_PORT="5173"
export SIDECAR_BIND_ADDR="127.0.0.1"   # no Docker port-mapping to hide a wildcard bind
# The web dev server (:3100, and :3000 for a second copy) calls this hub straight
# from the browser (NEXT_PUBLIC_SIDECAR_URL=http://127.0.0.1:5173). A shipped hub
# allows no other origin (BUG-858), so a dev hub names them here.
export SIDECAR_CORS_ORIGINS="${SIDECAR_CORS_ORIGINS:-http://localhost:3100,http://localhost:3000}"

NAV_PID=""; SIDE_PID=""
cleanup() {
  echo "[supervisor] stopping…"
  [ -n "$SIDE_PID" ] && kill "$SIDE_PID" 2>/dev/null || true
  [ -n "$NAV_PID" ]  && kill "$NAV_PID"  2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$RUNDIR/navidrome.pid" "$RUNDIR/sidecar.pid"
  echo "[supervisor] stopped."
}
trap cleanup INT TERM EXIT

echo "[supervisor] starting Navidrome (music=$ND_MUSICFOLDER data=$ND_DATAFOLDER ffmpeg=${FFMPEG:-NONE})"
"$NAVIDROME_BIN" >"$LOGDIR/navidrome.log" 2>&1 &
NAV_PID=$!
echo "$NAV_PID" >"$RUNDIR/navidrome.pid"

echo -n "[supervisor] waiting for http://localhost:4533/ping "
ready=0
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:4533/ping" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$NAV_PID" 2>/dev/null; then echo " — Navidrome exited early"; exit 1; fi
  echo -n "."; sleep 1
done
[ "$ready" = 1 ] || { echo " — TIMEOUT"; exit 1; }
echo " healthy."

echo "[supervisor] starting sidecar (navidrome=$NAVIDROME_BASE_URL, no HOST_HOSTNAME)"
"$SIDECAR_BIN" >"$LOGDIR/sidecar.log" 2>&1 &
SIDE_PID=$!
echo "$SIDE_PID" >"$RUNDIR/sidecar.pid"

echo "[supervisor] up. Navidrome pid=$NAV_PID  sidecar pid=$SIDE_PID"
echo "[supervisor]   UI:      http://localhost:4533"
echo "[supervisor]   wizard:  http://localhost:5173"
echo "[supervisor]   logs:    $LOGDIR/{navidrome,sidecar}.log"

# Supervise: if either dies, bring the whole stack down (compose parity).
while kill -0 "$NAV_PID" 2>/dev/null && kill -0 "$SIDE_PID" 2>/dev/null; do sleep 2; done
echo "[supervisor] a child exited — shutting down."
