#!/bin/bash
# Cassette Player — Dev Script
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# Starts the local dev environment with debug logging and fast scan interval.
# Run from: apps/cassette-player/
# Usage: pnpm dev   OR   bash scripts/dev.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo ""
echo "🎵 Cassette Player — Dev Mode"
echo "=============================="
echo ""

# ─── Preflight checks ─────────────────────────────────────────────────────────

if [ ! -d "./navidrome" ]; then
  echo "❌ Navidrome not cloned yet. Run 'pnpm setup' first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is required. Install from https://www.docker.com/get-started/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker daemon is not running. Start Docker and try again."
  exit 1
fi

# ─── Music file check ─────────────────────────────────────────────────────────

MUSIC_COUNT=$(find ./music -type f \( -name "*.flac" -o -name "*.mp3" -o -name "*.ogg" -o -name "*.m4a" -o -name "*.opus" \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$MUSIC_COUNT" -eq 0 ]; then
  echo "⚠️  No music files found in ./music/"
  echo "   Navidrome will start but your library will be empty."
  echo "   Add FLAC/MP3/OGG/M4A/OPUS files to ./music/ to test the player."
  echo ""
else
  echo "🎵 Found $MUSIC_COUNT music file(s) in ./music/"
fi

# ─── Host hostname ────────────────────────────────────────────────────────────
# Detect the Mac's mDNS hostname and export it so Docker Compose can pass it
# into the sidecar container. The sidecar registers this value with cassette.digital
# as the LAN address — it must be routable on Wi-Fi, not the Docker container ID.

HOST_HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || hostname).local"
export HOST_HOSTNAME
echo "🖥️  Host hostname: $HOST_HOSTNAME"
echo ""

# ─── Start ────────────────────────────────────────────────────────────────────

echo "🐳 Starting Navidrome with dev overrides..."
echo "   (debug logging, 5-minute scan interval)"
echo ""
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

echo ""
echo "✅ Cassette Player is running!"
echo ""
echo "   URL:  http://localhost:4533"
echo "   Logs: pnpm docker:logs"
echo "   Stop: pnpm docker:down"
echo ""
echo "💡 First run? Create an admin account at http://localhost:4533"
echo "💡 Theming: edit theme/cassette-theme.css and reload the page"
echo "   (CSS is mounted as a volume — no container restart needed)"
echo ""
