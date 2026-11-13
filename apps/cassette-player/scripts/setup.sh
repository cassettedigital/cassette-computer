#!/bin/bash
# Cassette Player — Setup Script
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# Clones Navidrome, checks prerequisites, and prepares the dev environment.
# Run from: apps/cassette-player/
# Usage: pnpm setup   OR   bash scripts/setup.sh

set -e

# Resolve script dir so this works regardless of cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo ""
echo "🎵 Cassette Player — Setup"
echo "=========================="
echo ""

# ─── Prerequisites ────────────────────────────────────────────────────────────

echo "Checking prerequisites..."
echo ""

MISSING=0

if ! command -v go >/dev/null 2>&1; then
  echo "  ❌ Go not found. Install from https://go.dev/dl/ (v1.22+ required)"
  MISSING=1
else
  GO_VERSION=$(go version | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
  echo "  ✅ Go $GO_VERSION"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Node.js not found. Install v20+ from https://nodejs.org"
  MISSING=1
else
  echo "  ✅ Node $(node -v)"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "  ❌ Docker not found. Install from https://www.docker.com/get-started/"
  MISSING=1
else
  DOCKER_VERSION=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  echo "  ✅ Docker $DOCKER_VERSION"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "  ❌ Git not found."
  MISSING=1
else
  echo "  ✅ Git $(git --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
fi

# TagLib is optional — only needed if building Navidrome from source
if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists taglib 2>/dev/null; then
  echo "  ✅ TagLib $(pkg-config --modversion taglib)"
else
  echo "  ⚠️  TagLib not found (optional — only needed to build from source)"
  echo "     Install with: brew install taglib   or   apt-get install libtag1-dev"
fi

echo ""

if [ "$MISSING" -eq 1 ]; then
  echo "❌ Missing required prerequisites. Install them and re-run this script."
  exit 1
fi

# ─── Clone Navidrome ──────────────────────────────────────────────────────────

NAVIDROME_DIR="./navidrome"

if [ -d "$NAVIDROME_DIR/.git" ]; then
  echo "📁 Navidrome already cloned at $NAVIDROME_DIR"
  echo "   Pulling latest changes..."
  (cd "$NAVIDROME_DIR" && git pull --ff-only)
else
  echo "📥 Cloning Navidrome..."
  git clone https://github.com/navidrome/navidrome.git "$NAVIDROME_DIR"
fi

echo ""
NAVIDROME_VERSION=$(cd "$NAVIDROME_DIR" && git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
echo "📌 Navidrome version: $NAVIDROME_VERSION"
echo ""

# ─── Create local directories ─────────────────────────────────────────────────

if [ ! -d "./music" ]; then
  mkdir -p ./music
  echo "📁 Created ./music/ — add FLAC/MP3/OGG files here for testing"
else
  MUSIC_COUNT=$(find ./music -type f \( -name "*.flac" -o -name "*.mp3" -o -name "*.ogg" -o -name "*.m4a" -o -name "*.opus" \) 2>/dev/null | wc -l | tr -d ' ')
  echo "📁 ./music/ exists ($MUSIC_COUNT audio files found)"
fi

if [ ! -d "./data" ]; then
  mkdir -p ./data
  echo "📁 Created ./data/ — Navidrome will store its database and cache here"
else
  echo "📁 ./data/ exists"
fi

echo ""

# ─── Copy env example ─────────────────────────────────────────────────────────

if [ ! -f "./.env.local" ]; then
  cp .env.example .env.local
  echo "📝 Created .env.local from .env.example — review and update before running"
else
  echo "📝 .env.local already exists"
fi

echo ""

# ─── Apply patches ────────────────────────────────────────────────────────────

PATCH_COUNT=$(find ./patches -name "*.patch" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PATCH_COUNT" -gt 0 ]; then
  echo "🩹 Applying $PATCH_COUNT patch(es)..."
  for patch in ./patches/*.patch; do
    echo "   Applying: $(basename "$patch")"
    (cd "$NAVIDROME_DIR" && git apply "../$patch") || {
      echo "   ⚠️  Patch failed — may already be applied or conflict with upstream"
    }
  done
  echo ""
fi

# ─── Done ─────────────────────────────────────────────────────────────────────

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add some music files to ./music/"
echo "     Tip: any FLAC, MP3, OGG, M4A, or OPUS files work"
echo ""
echo "  2. Start Navidrome:"
echo "     pnpm dev       → with debug logging + fast scan interval"
echo "     pnpm docker:up → in the background with production settings"
echo ""
echo "  3. Open http://localhost:4533"
echo "     On first run, you'll be prompted to create an admin account."
echo ""
echo "  4. Inspect the DOM and refine theme/cassette-theme.css"
echo "     See theme/README.md for the theming workflow."
echo ""
echo "  5. Analyze the storage layer:"
echo "     pnpm analyze"
echo "     (requires Navidrome source to be cloned — done above)"
echo ""
