#!/usr/bin/env bash
# One-time data migration for the native / .app build.
#
# A double-click .app is launched by LaunchServices and CANNOT read the repo's
# data/music under ~/Documents without a TCC "Files & Folders" grant (macOS
# blocks it — Navidrome silently fails to open its DB). So the canonical native
# data lives in non-TCC locations:
#
#   data  -> ~/Library/Application Support/Cassette Player
#   music -> ~/Music/Cassette
#
# This script COPIES the existing repo spine (navidrome.db + sidecar.json +
# caches + music) there once, preserving pairing/library. The repo copies are
# left untouched as a backup. Idempotent: skips if the destination DB exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # apps/cassette-player
DATA_DST="${CASSETTE_DATA_DIR:-$HOME/Library/Application Support/Cassette Player}"
MUSIC_DST="${CASSETTE_MUSIC_DIR:-$HOME/Music/Cassette}"

mkdir -p "$DATA_DST" "$MUSIC_DST"

if [ -f "$DATA_DST/navidrome.db" ]; then
  echo "data already migrated → $DATA_DST (skipping DB copy)"
else
  echo "migrating spine → $DATA_DST"
  cp "$ROOT/data/navidrome.db" "$DATA_DST/"
  cp "$ROOT/data/navidrome.db-wal" "$DATA_DST/" 2>/dev/null || true
  cp "$ROOT/data/navidrome.db-shm" "$DATA_DST/" 2>/dev/null || true
  cp "$ROOT/data/sidecar.json" "$DATA_DST/"
  rsync -a "$ROOT/data/cache" "$DATA_DST/" 2>/dev/null || true
  rsync -a "$ROOT/data/artwork" "$DATA_DST/" 2>/dev/null || true
fi

echo "syncing music → $MUSIC_DST"
rsync -a "$ROOT/music/" "$MUSIC_DST/"

echo "done."
echo "  data:  $DATA_DST"
echo "  music: $MUSIC_DST"
echo "  (repo data/ and music/ left intact as backup)"
