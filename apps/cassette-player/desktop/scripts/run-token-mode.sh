#!/usr/bin/env bash
#
# Run the desktop's bundled server in TOKEN MODE — the Move-3 proof.
#
# This is the exact standalone Next server the shipped desktop app runs, started
# with NO database password. Its album page fetches its data from the cloud over
# the per-device bearer token (the one stored in the OS keychain when you paired),
# instead of reaching the production database directly.
#
#   Web today:      desktop server  --(DATABASE_URL)-->  Neon
#   Token mode:     desktop server  --(bearer token)-->  cloud API  -->  Neon
#
# Usage:
#   scripts/run-token-mode.sh                 # reads the paired token from Keychain
#   CASSETTE_CLOUD_BASE=http://localhost:3100 scripts/run-token-mode.sh
#   CASSETTE_PLAYER_TOKEN=<token> scripts/run-token-mode.sh   # explicit token
#
# Then open  http://localhost:3200/album/in-rainbows  — or point the desktop shell
# at it:  CASSETTE_UI_URL=http://localhost:3200 <desktop binary>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STANDALONE_ROOT="$REPO_ROOT/apps/cassette/.next-desktop/standalone"
SERVER="$STANDALONE_ROOT/apps/cassette/server.js"
PORT="${PORT:-3200}"
CLOUD="${CASSETTE_CLOUD_BASE:-http://localhost:3100}"

if [ ! -f "$SERVER" ]; then
  echo "Standalone server not built. Run: DESKTOP_BUILD=1 pnpm --filter cassette build" >&2
  exit 1
fi
# Next standalone output OMITS static/ and public/ — without them the page loads
# with no CSS/JS (assets 404, page looks broken). Stage them in exactly as
# bundle-macos.sh does. Idempotent (clear first so cp -R can't nest static/static).
WEB_DIR="$REPO_ROOT/apps/cassette"
DISTDIR=".next-desktop"
echo "Staging static + public assets into the standalone tree…"
rm -rf "$STANDALONE_ROOT/apps/cassette/$DISTDIR/static" "$STANDALONE_ROOT/apps/cassette/public"
cp -R "$WEB_DIR/$DISTDIR/static" "$STANDALONE_ROOT/apps/cassette/$DISTDIR/static"
[ -d "$WEB_DIR/public" ] && cp -R "$WEB_DIR/public" "$STANDALONE_ROOT/apps/cassette/public"

# Run from the standalone root (its bundled node_modules resolve relative to it),
# exactly as the shipped shell's spawn_server does.
cd "$STANDALONE_ROOT"

# The device token the app stored in the OS keychain when you paired. Overridable
# via CASSETTE_PLAYER_TOKEN for testing.
TOKEN="${CASSETTE_PLAYER_TOKEN:-$(security find-generic-password -s digital.cassette.desktop -a device-token -w 2>/dev/null || true)}"
if [ -z "$TOKEN" ]; then
  echo "No device token in the keychain (service=digital.cassette.desktop). Pair the desktop app first." >&2
  exit 1
fi

echo "Token-mode server:  http://localhost:$PORT"
echo "  cloud (data over token):  $CLOUD"
echo "  DATABASE_URL:             (unset — no password in this process)"
echo

# Explicitly strip every DB/auth secret from the environment so this process
# provably cannot reach the database. `createLazyDb` only connects on first query,
# so the server boots fine and the album page renders purely from the token'd API.
exec env -u DATABASE_URL -u DATABASE_URL_APP -u AUTH_SECRET -u AUTH_GOOGLE_ID -u AUTH_GOOGLE_SECRET \
  CASSETTE_PLAYER_TOKEN="$TOKEN" \
  CASSETTE_CLOUD_BASE="$CLOUD" \
  PORT="$PORT" \
  HOSTNAME=127.0.0.1 \
  NODE_ENV=production \
  node "$SERVER"
