#!/usr/bin/env bash
#
# Build + install "Cassette Dev.app" — a SECOND, separate app (distinct name +
# icon + bundle id `digital.cassette.desktop.dev`) that always points at the
# local dev server (:3100). Double-clickable; no terminal, no env var.
#
# It carries NO bundled UI server (the shell's `.dev` identifier makes lib.rs
# target http://localhost:3100), so it's a tiny shell — start the dev server
# (`pnpm --filter cassette dev`) before launching it.
#
# The prod app (`Cassette.app`, id `digital.cassette.desktop`) is untouched and
# stays a separate, pinnable app.
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_OUT="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/Cassette Dev.app"
INSTALL_DIR="/Applications/Cassette Dev.app"

if [[ ! -f "$DESKTOP_DIR/src-tauri/icons-dev/icon.icns" ]]; then
  echo "!! Missing dev icons. Regenerate with:"
  echo "   magick src-tauri/icons/icon.png -modulate 100,115,150 -fill '#0b1220' -draw 'roundrectangle 150,384 362,470 20,20' -gravity South -font '/System/Library/Fonts/Supplemental/Arial Bold.ttf' -pointsize 74 -fill '#4fd1c5' -annotate +0+30 'DEV' /tmp/dev-source.png"
  echo "   pnpm tauri icon /tmp/dev-source.png -o src-tauri/icons-dev"
  exit 1
fi

echo "==> Building Cassette Dev.app (points at :3100, distinct icon)…"
pnpm -C "$DESKTOP_DIR" tauri build --config src-tauri/tauri.dev.conf.json

echo "==> Installing to ${INSTALL_DIR}…"
pkill -f "$INSTALL_DIR/Contents/MacOS/" 2>/dev/null || true
sleep 1
rm -rf "$INSTALL_DIR"
ditto "$APP_OUT" "$INSTALL_DIR"

echo "==> Done. Start ':3100' then double-click \"Cassette Dev\"."
