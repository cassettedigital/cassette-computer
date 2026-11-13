#!/bin/bash
# Cassette Player — Filesystem Analysis Script
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# Greps Navidrome's Go source for filesystem access patterns.
# This is how we understand what needs to change for the R2 storage adapter.
#
# Run from: apps/cassette-player/
# Usage: pnpm analyze
#   OR:  bash scripts/analyze-filesystem.sh ./navidrome
#   OR:  bash scripts/analyze-filesystem.sh /path/to/navidrome

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NAVIDROME_DIR="${1:-./navidrome}"

if [ ! -d "$NAVIDROME_DIR" ]; then
  echo "❌ Navidrome directory not found: $NAVIDROME_DIR"
  echo "   Run 'pnpm setup' first, or pass the path as an argument:"
  echo "   bash scripts/analyze-filesystem.sh /path/to/navidrome"
  exit 1
fi

echo ""
echo "=== Filesystem Analysis: Navidrome ==="
echo "Directory: $NAVIDROME_DIR"
echo "Purpose: Identify filesystem access patterns for R2 adapter design"
echo ""

# ─── Direct filesystem operations ─────────────────────────────────────────────

echo "────────────────────────────────────────────────────────────"
echo "1. os.Open / os.ReadFile / os.Stat / os.ReadDir"
echo "   (Direct file system reads — primary R2 adapter targets)"
echo "────────────────────────────────────────────────────────────"
grep -rn "os\.\(Open\|ReadFile\|Stat\|ReadDir\|MkdirAll\|Mkdir\|Remove\|Create\|WriteFile\)" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | head -60
echo ""

echo "────────────────────────────────────────────────────────────"
echo "2. filepath operations"
echo "   (Path manipulation — shows directory structure assumptions)"
echo "────────────────────────────────────────────────────────────"
grep -rn "filepath\.\(Join\|Walk\|WalkDir\|Glob\|Abs\|Rel\|Dir\|Base\)" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | head -60
echo ""

echo "────────────────────────────────────────────────────────────"
echo "3. ioutil (deprecated but may exist in older code)"
echo "────────────────────────────────────────────────────────────"
grep -rn "ioutil\." \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | head -20
echo ""

# ─── Storage interfaces & abstractions ────────────────────────────────────────

echo "────────────────────────────────────────────────────────────"
echo "4. Storage interfaces (does Navidrome abstract the filesystem?)"
echo "────────────────────────────────────────────────────────────"
grep -rn "type.*interface" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | grep -i "storage\|file\|media\|scanner\|reader\|writer" \
  | head -30
echo ""

echo "────────────────────────────────────────────────────────────"
echo "5. Scanner / MediaFile structures"
echo "   (The scanning pipeline — where music files are discovered)"
echo "────────────────────────────────────────────────────────────"
grep -rn "type.*Scanner\|type.*MediaFile\|type.*MediaScanner" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | head -20
echo ""

echo "────────────────────────────────────────────────────────────"
echo "6. MusicFolder / DataFolder config usage"
echo "   (How config values flow into filesystem access)"
echo "────────────────────────────────────────────────────────────"
grep -rn "MusicFolder\|DataFolder\|musicFolder\|dataFolder\|conf\.Server\." \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | head -30
echo ""

# ─── Streaming & transcoding ──────────────────────────────────────────────────

echo "────────────────────────────────────────────────────────────"
echo "7. Streaming / transcoding file access"
echo "   (How audio files are opened for streaming — critical for R2)"
echo "────────────────────────────────────────────────────────────"
grep -rn "stream\|transcode\|ffmpeg\|pipe" \
  "$NAVIDROME_DIR/server" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | grep -i "os\.Open\|os\.ReadFile\|filepath\|\.Open\b" \
  | head -20
echo ""

# ─── Cover art ────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────────────────────────"
echo "8. Cover art file access"
echo "────────────────────────────────────────────────────────────"
grep -rn "cover\|artwork\|CoverArt\|coverArt" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  | grep -v "_test\.go" \
  | grep -i "os\.Open\|os\.ReadFile\|filepath\|\.Open\b" \
  | head -20
echo ""

# ─── Package summary ──────────────────────────────────────────────────────────

echo "────────────────────────────────────────────────────────────"
echo "9. Go packages / directories with most filesystem access"
echo "   (Helps prioritize which files to audit first)"
echo "────────────────────────────────────────────────────────────"
grep -rn "os\.\(Open\|ReadFile\|Stat\|ReadDir\)" \
  "$NAVIDROME_DIR" \
  --include="*.go" \
  --exclude-dir="vendor" \
  --exclude-dir=".git" \
  -l \
  | grep -v "_test\.go" \
  | sed "s|$NAVIDROME_DIR/||" \
  | sort
echo ""

echo "=== Analysis complete ==="
echo ""
echo "Next step: Document findings in storage/FILESYSTEM_ANALYSIS.md"
echo ""
