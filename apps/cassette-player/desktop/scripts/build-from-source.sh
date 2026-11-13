#!/usr/bin/env bash
#
# Build Cassette for your computer from source, on a Mac with none of Cassette's own keys: the player
# screens, the hub, the music server (from its public fork), the window and the audio helper, signed
# ad-hoc, into desktop/src-tauri/target/release/bundle/macos/Cassette.app. Nothing is installed over
# /Applications. Steps and what to install first: apps/cassette-player/BUILDING.md.
#
# Works in the public copy (github.com/cassettedigital/cassette-computer) and in Cassette's own repository;
# both lay the computer app out the same way. The last step is the release script itself
# (bundle-macos.sh --rebuild --no-install), so this builds exactly what a release builds, minus the
# signing, notarizing and publishing that stay with Cassette.
#
#   apps/cassette-player/desktop/scripts/build-from-source.sh
#
# Your own AcoustID and gnudb settings, if you have them, go in apps/cassette-player/.env (.env.example
# says how); without them the app still rips, recognising discs from MusicBrainz and the disc itself.
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$(cd "$DESKTOP_DIR/.." && pwd)"
REPO_ROOT="$(cd "$NATIVE_DIR/../.." && pwd)"
NAVIDROME_URL="https://github.com/cassettedigital/cassette-navidrome"

need() { command -v "$1" >/dev/null || { echo "FATAL: $1 not found: $2 (see apps/cassette-player/BUILDING.md)" >&2; exit 1; }; }
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "FATAL: this build is for a Mac with Apple silicon" >&2; exit 1; }
need git "Xcode command line tools"
need swiftc "Xcode command line tools"
need node "Node.js 20 or newer"
need pnpm "pnpm 9 (corepack enable)"
need go "Go"
need cargo "Rust (rustup)"
need cmake "brew install cmake"
command -v pkgconf >/dev/null || command -v pkg-config >/dev/null || { echo "FATAL: pkgconf not found: brew install pkgconf" >&2; exit 1; }

echo "==> The player screens' packages…"
pnpm -C "$REPO_ROOT" install
pnpm -C "$REPO_ROOT" --filter "cassette^..." build

echo "==> The window's build tools…"
# its own project with its own lockfile, not part of the repository's workspace
pnpm -C "$DESKTOP_DIR" install --frozen-lockfile --ignore-workspace

if [[ ! -f "$NATIVE_DIR/navidrome/go.mod" ]]; then
  echo "==> The music server: $NAVIDROME_URL (cassette branch)…"
  git clone --depth 1 --branch cassette "$NAVIDROME_URL" "$NATIVE_DIR/navidrome"
fi

echo "==> Everything else, the release script's own way (ad-hoc signed, not installed)…"
CASSETTE_SIGN_ID="${CASSETTE_SIGN_ID:--}" exec "$DESKTOP_DIR/scripts/bundle-macos.sh" --rebuild --no-install
