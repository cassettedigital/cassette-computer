#!/usr/bin/env bash
#
# Build + install the Cassette desktop app (macOS).
#
# Produces a self-contained /Applications/Cassette.app: the player screens, from
# the public copy (export/screens.mjs, never the whole website, board #1207), are
# built in "standalone" mode and copied INSIDE the app; at launch the shell
# spawns it on a local port (see src-tauri/src/lib.rs) and points the window at
# it. Data still streams from the cloud DB — only the UI/assets are bundled.
#
# Why this script exists instead of Tauri's `bundle.resources`: the standalone
# server's node_modules is a pnpm tree with ~370 relative symlinks, and Tauri's
# resource copier DROPS symlinks (gutting the module tree). So we copy the tree
# ourselves with `cp -R` (preserves relative symlinks) and re-sign.
#
# The app identity is FIXED — path /Applications/Cassette.app, name "Cassette",
# bundle id digital.cassette.desktop — so re-running this updates the same app
# in place and the Dock pin never breaks.
#
# Usage:  ./scripts/bundle-macos.sh             (fast: reuse standalone, ad-hoc sign)
#         ./scripts/bundle-macos.sh --rebuild   (rebuild the Next.js standalone first)
#         ./scripts/bundle-macos.sh --notarize  (Developer ID sign + notarize + staple)
#         ./scripts/bundle-macos.sh --publish   (cut an auto-update release; needs --notarize)
#         flags combine, in any order.
#
# --publish (auto-update release): after notarizing, tar the .app, minisign-sign
# it, and upload the archive + feed manifest to R2 so installed apps auto-update
# (see src-tauri/src/lib.rs spawn_update_check + app/api/desktop/update). Requires
# the signing key in the environment:
#   TAURI_SIGNING_PRIVATE_KEY (or _PATH) + TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# and R2 creds in apps/cassette/.env.local. BUMP tauri.conf.json "version" first —
# the feed compares it against each client's running version. See UPDATER.md.
#
# --notarize means "this is a release": it always rebuilds the UI, refuses any cloud
# but production, a dirty or unpushed Navidrome fork, a missing tool, or any program
# needing a newer macOS than tauri.conf.json's minimumSystemVersion (BUG-773, 785).
# Helpers: build-tools-macos.sh (rip/transcode tools from source), collect-notices.py
# (Resources/Licenses), check-macos-floor.sh (the minimum-macOS gate).
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# --- flags ---
REBUILD=false; NOTARIZE=false; PUBLISH=false; NO_INSTALL=false
for a in "$@"; do
  case "$a" in
    --rebuild)    REBUILD=true ;;
    --notarize)   NOTARIZE=true ;;
    --publish)    PUBLISH=true ;;
    # Build (and optionally notarize/publish) WITHOUT replacing /Applications/
    # Cassette.app — used to cut a release the local install can then update TO via
    # the in-app pill, instead of overwriting it with the new build.
    --no-install) NO_INSTALL=true ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

# Publishing an update feed from a non-notarized (ad-hoc) build would push a
# bundle Gatekeeper rejects — refuse early.
if [[ "$PUBLISH" == true && "$NOTARIZE" != true ]]; then
  echo "--publish requires --notarize (won't publish an un-notarized build)." >&2
  exit 2
fi
if [[ "$PUBLISH" == true && -z "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  echo "--publish needs TAURI_SIGNING_PRIVATE_KEY (or _PATH) in the environment. See UPDATER.md." >&2
  exit 2
fi

# A notarized build is a release: finish-release.sh (or --publish) ships exactly this app
# to everyone through the update pill and /download. So it never reuses an old UI build,
# never talks to anything but production, and every check below that only warns on a
# local build stops a release (BUG-785).
PROD_CLOUD="https://www.cassette.digital"
if [[ "$NOTARIZE" == true ]]; then
  REBUILD=true
  if [[ "${CASSETTE_CLOUD_BASE:-$PROD_CLOUD}" != "$PROD_CLOUD" ]]; then
    echo "FATAL: a release must talk to $PROD_CLOUD, not CASSETTE_CLOUD_BASE=$CASSETTE_CLOUD_BASE" >&2
    exit 2
  fi
fi
# The oldest macOS the app promises (the site says the same). Every program built
# below targets it, and check-macos-floor.sh refuses a bundle with anything newer
# (BUG-773): macOS won't start a program built for a newer system than it is.
MIN_MACOS="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bundle"]["macOS"]["minimumSystemVersion"])' \
  "$(cd "$(dirname "$0")/.." && pwd)/src-tauri/tauri.conf.json")"
GO_TARGET_ENV=(
  "MACOSX_DEPLOYMENT_TARGET=$MIN_MACOS"
  "CGO_CFLAGS=-O2 -g -mmacosx-version-min=$MIN_MACOS"
  "CGO_LDFLAGS=-mmacosx-version-min=$MIN_MACOS"
)

# Developer ID signing: --notarize signs with it, and a local build does too when this Mac has it (the
# re-sign below). The identity is this Mac's own Developer ID certificate (CASSETTE_SIGN_ID names one when
# there are several, and CASSETTE_SIGN_ID=- signs ad-hoc whatever the Mac has); a Mac with none builds
# ad-hoc. notarytool reads the stored
# "cassette-notary" Keychain profile — no secret in this file.
SIGN_ID="${CASSETTE_SIGN_ID:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[[ "$SIGN_ID" == "-" ]] && SIGN_ID=""
if [[ "$NOTARIZE" == true && -z "$SIGN_ID" ]]; then
  echo "FATAL: --notarize needs a Developer ID Application certificate in this Mac's keychain" >&2
  exit 2
fi
NOTARY_PROFILE="cassette-notary"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../../.." && pwd)"
# The website's folder: its .env.local and the release uploader. Never what the window is built from.
SITE_DIR="$REPO_ROOT/apps/cassette"
EXPORT_DIR="$DESKTOP_DIR/../export"

# The window's server is built from the public copy of the player screens, never from the website itself
# (board #1207): Next copies into the server every file any page of what it builds reads, so building the
# website put the taste recipes, Admin, AI prompts and press lists into every download. In Cassette's own
# repository the copy is made by export/screens.mjs (a release: the public repo's own tag; any other build:
# an export of this folder); in the public copy (no export/ folder) the copy is this folder itself.
if [[ -f "$EXPORT_DIR/screens.mjs" ]]; then
  SCREENS_ROOT="${CASSETTE_SCREENS_DIR:-$HOME/Library/Caches/cassette-screens}"
else
  SCREENS_ROOT="$REPO_ROOT"
fi
WEB_DIR="$SCREENS_ROOT/apps/cassette"
APP_VERSION="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$DESKTOP_DIR/src-tauri/tauri.conf.json")"

# One version, one commit, one tag: once the computer app's public repo exists, a release goes out only if
# that repo has its version's tag, exported from this very commit (export/source-gate.mjs). The uploader
# checks again; this stops a release that can't go out before the long build instead of after it.
BUILT_FROM="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ "$PUBLISH" == true ]]; then
  node "$EXPORT_DIR/source-gate.mjs" --version "$APP_VERSION" --commit "$BUILT_FROM" --repo-dir "$REPO_ROOT" || exit 1
fi
# Desktop builds use a separate distDir (next.config.ts) so they never clobber a
# running `next dev` that owns the default .next.
DISTDIR=".next-desktop"
STANDALONE="$WEB_DIR/$DISTDIR/standalone"
APP_OUT="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/Cassette.app"
INSTALL_DIR="/Applications/Cassette.app"

if [[ "$REBUILD" == true || ! -f "$STANDALONE/apps/cassette/server.js" ]]; then
  if [[ "$SCREENS_ROOT" != "$REPO_ROOT" ]]; then
    if [[ "$NOTARIZE" == true ]]; then
      node "$EXPORT_DIR/screens.mjs" --out "$SCREENS_ROOT" --release "$APP_VERSION" --commit "$BUILT_FROM"
    else
      node "$EXPORT_DIR/screens.mjs" --out "$SCREENS_ROOT"
    fi
    echo "==> Installing the screens' packages (their own lockfile) and building the shared ones…"
    ( cd "$SCREENS_ROOT" && pnpm install --frozen-lockfile --reporter=silent && pnpm --filter "cassette^..." run build )
  fi
  echo "==> Building Next.js standalone (DESKTOP_BUILD=1) from ${SCREENS_ROOT}…"
  # NEXT_PUBLIC_SIDECAR_URL=/sidecar routes the sidecar client through the app's
  # own same-origin proxy (app/sidecar/[...path]/route.ts) instead of the CORS-
  # gated https://local.cassette.digital:5173 portal.
  ( cd "$SCREENS_ROOT" && NEXT_PUBLIC_SIDECAR_URL=/sidecar DESKTOP_BUILD=1 pnpm --filter cassette build )
fi

echo "==> Staging static + public into the standalone tree…"
# Idempotent: a fast rebuild (no --rebuild) reuses the standalone, so clear the
# prior copies first or cp -R would nest them (static/static).
rm -rf "$STANDALONE/apps/cassette/$DISTDIR/static" "$STANDALONE/apps/cassette/public"
cp -R "$WEB_DIR/$DISTDIR/static" "$STANDALONE/apps/cassette/$DISTDIR/static"
cp -R "$WEB_DIR/public" "$STANDALONE/apps/cassette/public"

echo "==> Building the Tauri shell (release)…"
# The builder's home folder stays out of the compiled window, as -trimpath keeps it out of the hub and
# the music server below.
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$HOME=~"
pnpm -C "$DESKTOP_DIR" tauri build

echo "==> Copying the UI server INTO the app (symlink-preserving)…"
rm -rf "$APP_OUT/Contents/Resources/server"
cp -R "$STANDALONE" "$APP_OUT/Contents/Resources/server"

# SECURITY (audit CRITICAL — Move 4, the finish of "protect the keys"): the shipped
# server carries NO database password and NO auth secret. It runs as a token-
# authenticated cloud client — the per-device bearer (set at pairing, in the OS
# keychain) is injected at spawn (src-tauri/src/lib.rs spawn_server), and all data
# streams from the cloud over that token. So the bundled .env holds ONLY non-secret
# runtime config, safe to distribute:
#   - CASSETTE_CLOUD_BASE: the origin serving /api/player/* and owning the DB.
#       Defaults to production. Override at build time to point a TEST build at a
#       local cloud that already has the (as-yet-undeployed) player endpoints, e.g.
#         CASSETTE_CLOUD_BASE=http://localhost:3100 ./scripts/bundle-macos.sh
#   - R2_DIAGNOSTICS_BUCKET: a bucket NAME (an identifier, not a credential; the
#       diagnostics ingest is anonymous-allowed), kept so report attachments resolve.
# The device token is per-device and is NEVER bundled — an unpaired copy holds no
# credential at all and drives pairing on first launch. A token-mode server boots
# fine with no DATABASE_URL (createLazyDb connects lazily) and no AUTH_SECRET (auth
# is disabled; the token is the identity), as proven by scripts/run-token-mode.sh.
BUNDLED_ENV="$APP_OUT/Contents/Resources/server/.env"
: > "$BUNDLED_ENV"
printf 'CASSETTE_CLOUD_BASE=%s\n' "${CASSETTE_CLOUD_BASE:-https://www.cassette.digital}" >> "$BUNDLED_ENV"
for KEY in R2_DIAGNOSTICS_BUCKET; do
  LINE=$(/usr/bin/grep -E "^${KEY}=" "$SITE_DIR/.env.local" | /usr/bin/head -1) || true
  [[ -n "$LINE" ]] && printf '%s\n' "$LINE" >> "$BUNDLED_ENV"
done
# Readable by every account on the Mac, like the rest of the bundle: whoever opens
# Cassette runs this copy as themselves, and the UI server reads this file as them.
# Owner-only (it was 600) left a second macOS account's server unable to start and
# its splash spinning forever (BUG-791). Nothing here is secret (see above), and the
# same file ships to everyone in the public download.
chmod 644 "$BUNDLED_ENV"
echo "==> Bundled runtime .env: NO database password, NO auth secret (token-mode client)."
echo "    cloud=${CASSETTE_CLOUD_BASE:-https://www.cassette.digital}  keys=$(/usr/bin/grep -c . "$BUNDLED_ENV" 2>/dev/null || echo 0)"

# Strip iCloud "* 2"/"* 3" duplicate cruft (the repo lives in ~/Documents, which
# iCloud syncs — it leaves unsigned duplicate binaries like `esbuild 2` that fail
# notarization). The canonical file is kept.
find "$APP_OUT/Contents/Resources/server" \( -name '* [0-9]' -o -name '* [0-9].*' \) -delete 2>/dev/null || true

# No source maps in the app (BUG-1009). A browser source map carries the website's original code, and
# the app goes to everyone who downloads it. The desktop build makes none (next.config.ts); this removes
# any a reused older build still has.
MAPS="$(find "$APP_OUT/Contents/Resources/server/apps/cassette/$DISTDIR" -name '*.map' | wc -l | tr -d ' ')"
if [[ "$MAPS" != 0 ]]; then
  echo "==> Removing $MAPS source maps from the UI server (BUG-1009)"
  find "$APP_OUT/Contents/Resources/server/apps/cassette/$DISTDIR" -name '*.map' -delete
fi

# The tripwire (board #1207): the server may carry the player screens and nothing else, no taste recipe, AI
# prompt, Admin page or website data file. Before signing, so a server that fails never becomes an app.
if [[ -f "$EXPORT_DIR/bundle-check.mjs" ]]; then
  node "$EXPORT_DIR/bundle-check.mjs" --server "$APP_OUT/Contents/Resources/server"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Native hub (the reconciliation): fold in everything native/build-app.sh used to
# bundle into a SEPARATE "Cassette Player.app". Now it all lives inside THIS app,
# so one Cassette owns + reaps the whole stack (src-tauri/src/lib.rs spawn_hub /
# reap_hub). The Resources layout MUST match resolve_hub_paths() in lib.rs:
#   cassette-sidecar, navidrome, bin/<tools+dylibs>, certs/, cassette.env,
#   CassetteAudio.app/Contents/MacOS/CassetteAudio
# Ported (not re-invented) from native/build-app.sh, which this now supersedes.
# ─────────────────────────────────────────────────────────────────────────────
NATIVE_DIR="$REPO_ROOT/apps/cassette-player"
RES="$APP_OUT/Contents/Resources"
BIN="$RES/bin"
NAVIDROME_SRC="$NATIVE_DIR/navidrome"
NAVIDROME_URL="https://github.com/cassettedigital/cassette-navidrome"
# This app's own public source, exported per release and tagged v<version> (apps/cassette-player/export)
CASSETTE_URL="https://github.com/cassettedigital/cassette-computer"
# A fresh bin/ every build, so nothing from an earlier build's tools rides along.
rm -rf "$BIN"
mkdir -p "$BIN"

command -v swiftc >/dev/null || { echo "FATAL: swiftc not found (needed for the audio helper)"; exit 1; }
command -v go     >/dev/null || { echo "FATAL: go not found (needed to build the sidecar)"; exit 1; }
[ -f "$NAVIDROME_SRC/go.mod" ] || { echo "FATAL: no Navidrome fork at $NAVIDROME_SRC (git clone -b cassette $NAVIDROME_URL)"; exit 1; }

echo "==> [hub] build sidecar from source (never ship a prebuilt artifact)…"
SIDECAR_VERSION="$(git -C "$NATIVE_DIR/sidecar" rev-parse --short HEAD 2>/dev/null || echo nogit)"
git -C "$NATIVE_DIR/sidecar" diff --quiet 2>/dev/null || SIDECAR_VERSION="${SIDECAR_VERSION}-dirty"
SIDECAR_VERSION="${SIDECAR_VERSION}+$(date +%H%M%S)"
( cd "$NATIVE_DIR/sidecar" && env "${GO_TARGET_ENV[@]}" go build -trimpath -ldflags "-X main.buildVersion=${SIDECAR_VERSION}" -o "$RES/cassette-sidecar" . ) \
  || { echo "FATAL: sidecar build failed"; exit 1; }
echo "    stamped $SIDECAR_VERSION"

echo "==> [hub] build navidrome from the fork…"
# Built here, from source, every time: a prebuilt binary could be stale or built for the
# builder's macOS. Navidrome is GPL-3 and the app points people at the public fork for
# its source, so a release ships only a commit that is on that fork, untouched (BUG-780).
NAVIDROME_COMMIT="$(git -C "$NAVIDROME_SRC" rev-parse HEAD)"
NAVIDROME_TAG="$(git -C "$NAVIDROME_SRC" describe --tags --abbrev=0 2>/dev/null || echo untagged)"
if [[ -n "$(git -C "$NAVIDROME_SRC" status --porcelain --untracked-files=no)" ]]; then
  [[ "$NOTARIZE" == true ]] && { echo "FATAL: the Navidrome fork has uncommitted changes; commit and push them first"; exit 1; }
  echo "    WARN: the Navidrome fork has uncommitted changes (refused for a release)"
fi
if ! git -C "$NAVIDROME_SRC" branch -r --contains "$NAVIDROME_COMMIT" 2>/dev/null | grep -q .; then
  [[ "$NOTARIZE" == true ]] && { echo "FATAL: Navidrome commit ${NAVIDROME_COMMIT:0:12} isn't on the public fork; push it first"; exit 1; }
  echo "    WARN: Navidrome commit ${NAVIDROME_COMMIT:0:12} isn't pushed (refused for a release)"
fi
( cd "$NAVIDROME_SRC" && env "${GO_TARGET_ENV[@]}" CGO_CFLAGS_ALLOW=--define-prefix go build -trimpath -tags=netgo,sqlite_fts5 \
    -ldflags "-X github.com/navidrome/navidrome/consts.gitSha=${NAVIDROME_COMMIT:0:8} -X github.com/navidrome/navidrome/consts.gitTag=${NAVIDROME_TAG}-cassette" \
    -o "$RES/navidrome" . ) \
  || { echo "FATAL: navidrome build failed"; exit 1; }
# No Last.fm and no Deezer, ever (CLAUDE.md; Patch 009, BUG-864). The binary embeds the fork's ui/build, which this
# script never rebuilds, so a stale ui/build on the building computer could bring their names back: check the
# binary itself.
BANNED_HITS="$(strings -a "$RES/navidrome" | grep -ciE 'audioscrobbler|last[._-]?fm|deezer|dzcdn' || true)"
if [[ "$BANNED_HITS" != "0" ]]; then
  [[ "$NOTARIZE" == true ]] && { echo "FATAL: the Navidrome binary mentions Last.fm or Deezer $BANNED_HITS times; rebuild the fork's ui/ (npm run build) from Patch 009 on"; exit 1; }
  echo "    WARN: the Navidrome binary mentions Last.fm or Deezer $BANNED_HITS times (refused for a release)"
fi

echo "==> [hub] compile the native audio helper → CassetteAudio.app…"
AUDIO_APP="$RES/CassetteAudio.app"
rm -rf "$AUDIO_APP"
mkdir -p "$AUDIO_APP/Contents/MacOS" "$AUDIO_APP/Contents/Resources"
# Same frameworks native/build-app.sh linked (the trimmed helper still carries the
# dead now-playing SwiftUI code for now, so SwiftUI stays linked).
swiftc -O -target "arm64-apple-macos$MIN_MACOS" -o "$AUDIO_APP/Contents/MacOS/CassetteAudio" "$NATIVE_DIR/native/app/main.swift" \
  -framework AppKit -framework DiskArbitration -framework AVFoundation \
  -framework Network -framework MediaPlayer -framework SwiftUI \
  -framework Accelerate -framework MediaToolbox \
  || { echo "FATAL: audio helper build failed"; exit 1; }
cat > "$AUDIO_APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>CassetteAudio</string>
  <key>CFBundleIdentifier</key><string>digital.cassette.desktop.audio</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>CassetteAudio</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- AVPlayer streams cleartext from the local Navidrome (localhost:4533). -->
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

echo "==> [hub] rip + transcode tools, built from source for macOS ${MIN_MACOS}…"
# Never the builder's Homebrew copies: those need the builder's own macOS and its ffmpeg
# is a GPL build (BUG-773, BUG-780). build-tools-macos.sh makes static, LGPL-or-
# separately-licensed tools at the app's floor and re-uses them until a version changes.
# Any tool missing stops the build: a Cassette that can't rip must never ship (BUG-785).
TOOLS_OUT="$("$DESKTOP_DIR/scripts/build-tools-macos.sh" | tail -1)"
for tool in ffmpeg flac fpcalc cd-paranoia cd-info; do
  [ -x "$TOOLS_OUT/bin/$tool" ] || { echo "FATAL: tools build has no $tool"; exit 1; }
  cp "$TOOLS_OUT/bin/$tool" "$BIN/$tool"
done

# The UI server needs a Node runtime, and a clean Mac has none (lib.rs resolve_paths
# looks for Resources/node first). An official build, pinned and checked against its
# published sha256, cached outside the repo so a rebuild doesn't fetch it again. The
# signing below covers it like every other Mach-O in Resources: it needs the
# allow-jit entitlement for V8, which entitlements.plist already grants.
NODE_VERSION="v24.22.2"
NODE_SHA256="1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115"
NODE_CACHE="$HOME/Library/Caches/cassette-node/$NODE_VERSION"
NODE_TARBALL="$NODE_CACHE/node.tar.xz"
echo "==> [ui] bundle Node ${NODE_VERSION}…"
[[ "$(uname -m)" == arm64 ]] || { echo "FATAL: the pinned Node is darwin-arm64; build on Apple silicon"; exit 1; }
mkdir -p "$NODE_CACHE"
if [[ ! -f "$NODE_TARBALL" ]] || ! shasum -a 256 "$NODE_TARBALL" | grep -q "^$NODE_SHA256 "; then
  curl -fsSL --max-time 300 -o "$NODE_TARBALL" \
    "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.xz"
fi
shasum -a 256 "$NODE_TARBALL" | grep -q "^$NODE_SHA256 " \
  || { echo "FATAL: Node tarball checksum mismatch"; exit 1; }
tar -xOf "$NODE_TARBALL" "node-$NODE_VERSION-darwin-arm64/bin/node" > "$RES/node"
chmod 755 "$RES/node"
"$RES/node" --version >/dev/null || { echo "FATAL: bundled Node won't run"; exit 1; }

echo "==> [legal] Licenses folder: every third-party licence + the GPL/LGPL sources…"
python3 "$DESKTOP_DIR/scripts/collect-notices.py" --out "$RES/Licenses" \
  --tools "$TOOLS_OUT" --tool-sources "$HOME/Library/Caches/cassette-tools/src" \
  --navidrome "$NAVIDROME_SRC" --navidrome-url "$NAVIDROME_URL" \
  --node-tarball "$NODE_TARBALL" --node-version "$NODE_VERSION" \
  --server "$RES/server" --sidecar "$NATIVE_DIR/sidecar" --cargo "$DESKTOP_DIR/src-tauri/Cargo.toml" \
  --cassette-url "$CASSETTE_URL" --cassette-licence "$NATIVE_DIR/LICENSE" \
  --cassette-version "$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$DESKTOP_DIR/src-tauri/tauri.conf.json")" \
  || { echo "FATAL: couldn't write the Licenses folder"; exit 1; }

echo "==> [hub] write cassette.env + bundle certs…"
# The folders go into cassette.env as literal $HOME tokens, resolved on the person's
# own Mac at launch (lib.rs expand_posix_env_tokens). Writing this builder's $HOME
# here pointed every installed copy at /Users/<builder>, so on anyone else's Mac the
# hub had no music folder and no data folder.
DATA_DIR="${CASSETTE_DATA_DIR:-\$HOME/Library/Application Support/Cassette Player}"
MUSIC_DIR="${CASSETTE_MUSIC_DIR:-\$HOME/Music/Cassette}"
# No TLS certificate ships in the app. The *.local.cassette.digital key is one
# private key for a public certificate; handing it to everyone who downloads the app
# is grounds for revoking it. The app reaches its hub over plain loopback HTTP
# (/sidecar proxy) and the phone over the LAN, so neither needs it. A hub that has
# its own certificate in its data folder (native/issue-cert.sh) still serves HTTPS.
mkdir -p "$RES/certs"
ADMIN_USER="admin"; ACOUSTID_KEY=""; GNUDB_CLIENT=""; GNUDB_MAIL=""; GNUDB_HOST_VAL=""
if [ -f "$NATIVE_DIR/.env" ]; then
  ADMIN_USER="$(grep -E '^NAVIDROME_ADMIN_USER=' "$NATIVE_DIR/.env" | cut -d= -f2- || echo admin)"
  ACOUSTID_KEY="$(grep -E '^ACOUSTID_API_KEY=' "$NATIVE_DIR/.env" | cut -d= -f2- || echo '')"
  GNUDB_CLIENT="$(grep -E '^GNUDB_CLIENT_NAME=' "$NATIVE_DIR/.env" | cut -d= -f2- || echo '')"
  GNUDB_MAIL="$(grep -E '^GNUDB_CONTACT_EMAIL=' "$NATIVE_DIR/.env" | cut -d= -f2- || echo '')"
  GNUDB_HOST_VAL="$(grep -E '^GNUDB_HOST=' "$NATIVE_DIR/.env" | cut -d= -f2- || echo '')"
fi
cat > "$RES/cassette.env" <<ENV
# Generated by bundle-macos.sh — points the sidecar + Navidrome at the canonical
# (non-TCC) data + music. No admin password: each install mints its own in its
# data folder (sidecar admin_setup.go).
ND_MUSICFOLDER=$MUSIC_DIR
ND_DATAFOLDER=$DATA_DIR
# Navidrome listens on this computer only, on 4534; the hub answers the phones on the
# Wi-Fi at 4533, the address they already have, encrypted (sidecar lan-tls.go, BUG-870).
ND_PORT=4534
CASSETTE_LAN_PORT=4533
ND_DEFAULTTHEME=Cassette
ND_SCANNER_SCHEDULE=1h
ND_SESSIONTIMEOUT=24h
ND_LOGLEVEL=info
ND_AGENTS=
# No outside services: usage reports, ListenBrainz, any artist-info agent (BUG-781).
# The hub forces these too, so this line only says it where the settings live.
ND_ENABLEEXTERNALSERVICES=false
ND_ENABLEINSIGHTSCOLLECTOR=false
CASSETTE_API_BASE=https://www.cassette.digital
NAVIDROME_BASE_URL=http://localhost:4534
NAVIDROME_ADMIN_USER=$ADMIN_USER
SIDECAR_DATA_DIR=$DATA_DIR
SIDECAR_MUSIC_DIR=$MUSIC_DIR
SIDECAR_PORT=5173
ACOUSTID_API_KEY=$ACOUSTID_KEY
GNUDB_HOST=$GNUDB_HOST_VAL
GNUDB_CLIENT_NAME=$GNUDB_CLIENT
GNUDB_CONTACT_EMAIL=$GNUDB_MAIL
ENV
# Readable by every account on the Mac, for the same reason as server/.env above:
# the shell reads it as whoever is running Cassette to start their hub (BUG-791).
# It holds nothing that every downloaded copy doesn't already carry: the AcoustID key
# is an app's client key made to ship inside apps, the rest is public addresses,
# ports, the admin's user name (never a password) and the name and contact address
# sent with every gnudb lookup. The folders are $HOME tokens each account resolves
# to its own (lib.rs expand_posix_env_tokens).
chmod 644 "$RES/cassette.env"

echo "==> [hub] verify the bundled sidecar carries current code (no stale ship)…"
VERIFY_SYMS="$(strings "$RES/cassette-sidecar" 2>/dev/null || true)"
for marker in "serving HTTPS" "/api/rip/reset" "/api/rip/confirm" "/api/sync/pending"; do
  case "$VERIFY_SYMS" in
    *"$marker"*) ;;
    *) echo "FATAL: bundled sidecar missing marker '$marker' — stale build, refusing to ship"; exit 1 ;;
  esac
done
echo "    ✓ sidecar is current"

echo "==> Checking every program runs on macOS ${MIN_MACOS}…"
"$DESKTOP_DIR/scripts/check-macos-floor.sh" "$APP_OUT"

if [[ "$NOTARIZE" == true ]]; then
  # Stage 2 gate: if a Developer ID provisioning profile is present, embed it and
  # sign with the associated-domains (AutoFill) entitlement. Without it, ship
  # Stage 1 entitlements (no restricted entitlement → launches with no profile).
  PROFILE="$DESKTOP_DIR/src-tauri/embedded.provisionprofile"
  if [[ -f "$PROFILE" ]]; then
    echo "==> Embedding provisioning profile → AutoFill (associated-domains) ON…"
    cp "$PROFILE" "$APP_OUT/Contents/embedded.provisionprofile"
    ENTITLEMENTS="$DESKTOP_DIR/src-tauri/entitlements.autofill.plist"
  else
    ENTITLEMENTS="$DESKTOP_DIR/src-tauri/entitlements.plist"
  fi

  echo "==> Signing nested Mach-O binaries inside-out (esbuild, sharp, libvips…)…"
  # --deep is unreliable for loose executables deep in Resources, so sign every
  # Mach-O individually (runtime + secure timestamp) BEFORE sealing the bundle.
  #
  # CRITICAL: sign with --entitlements, NOT bare hardened runtime. A nested Mach-O
  # does NOT inherit the outer app's entitlements — each process needs its own. The
  # bundled Navidrome scanner reads tags via a WASM taglib engine (go-taglib →
  # wazero) that JITs to native code, and hardened runtime SIGKILLs any process
  # that allocates JIT memory without com.apple.security.cs.allow-jit. Signing the
  # nested binaries bare (no entitlements) was an instant, silent scanner death:
  # the server ran but every scan was killed the moment it touched a tag, so no
  # ripped/added music ever reached the library (BUG-256). These entitlements are
  # self-granted hardened-runtime exceptions (no provisioning profile) and notarize
  # fine; harmless on binaries that don't JIT. Do NOT drop --entitlements here.
  while IFS= read -r f; do
    if /usr/bin/file "$f" | /usr/bin/grep -q "Mach-O"; then
      codesign --force --options runtime --timestamp \
        --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$f"
    fi
  done < <(find "$APP_OUT/Contents/Resources" "$APP_OUT/Contents/Frameworks" -type f 2>/dev/null)

  # Seal the nested audio helper as a bundle AFTER the loop above signed its inner
  # Mach-O — inside-out, before the outer app is sealed.
  echo "==> Sealing the nested audio helper (CassetteAudio.app)…"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$AUDIO_APP"

  echo "==> Sealing the app bundle (hardened runtime + entitlements)…"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$SIGN_ID" "$APP_OUT"
  codesign --verify --strict --verbose=2 "$APP_OUT"

  echo "==> Notarizing (uploading to Apple — a few minutes)…"
  ZIP="$(dirname "$APP_OUT")/Cassette-notarize.zip"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$APP_OUT" "$ZIP"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  rm -f "$ZIP"
  echo "==> Stapling the notarization ticket…"
  xcrun stapler staple "$APP_OUT"

  # The disk image a new person installs from (/download → /api/desktop/download):
  # the stapled app beside an Applications link, signed, notarized and stapled
  # itself so Gatekeeper opens it offline. Updates keep using the .tar.gz.
  DMG="$(dirname "$APP_OUT")/Cassette.dmg"
  DMG_STAGE="$(mktemp -d)"
  echo "==> Building $(basename "$DMG")…"
  ditto "$APP_OUT" "$DMG_STAGE/Cassette.app"
  ln -s /Applications "$DMG_STAGE/Applications"
  rm -f "$DMG"
  hdiutil create -volname "Cassette" -srcfolder "$DMG_STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
  rm -rf "$DMG_STAGE"
  codesign --force --timestamp --sign "$SIGN_ID" "$DMG"
  echo "==> Notarizing the disk image…"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 || true
else
  # A local build signs with the Developer ID when this Mac has it, else ad-hoc. The Keychain ties
  # "Always Allow" (the pairing token, src/pairing.rs) to the app's signature: an ad-hoc one is new
  # every build, so every rebuild asked for the password again. The Developer ID's stays the same
  # from build to build (and matches a notarized release's). No hardened runtime and no timestamp
  # here: the fast path stays offline and the nested binaries keep running as they did.
  LOCAL_ID="-"
  if [[ -n "$SIGN_ID" ]] && security find-identity -v -p codesigning 2>/dev/null | grep -qF "$SIGN_ID"; then LOCAL_ID="$SIGN_ID"; fi
  echo "==> Re-signing ($([[ "$LOCAL_ID" == "-" ]] && echo ad-hoc || echo Developer ID)): native hub binaries + helper inside-out, then the bundle…"
  # Sign the NEW native bits (arm64 refuses to exec an unsigned Mach-O, even ad-hoc);
  # leave the server tree as the current fast path did.
  for f in "$RES/cassette-sidecar" "$RES/navidrome" "$RES/node" "$BIN"/*; do
    [ -f "$f" ] && codesign --force -s "$LOCAL_ID" "$f" 2>/dev/null || true
  done
  codesign --force -s "$LOCAL_ID" "$AUDIO_APP/Contents/MacOS/CassetteAudio" 2>/dev/null || true
  codesign --force -s "$LOCAL_ID" "$AUDIO_APP" 2>/dev/null || true
  codesign --force -s "$LOCAL_ID" "$APP_OUT"
  codesign --verify "$APP_OUT"
fi

if [[ "$NO_INSTALL" == true ]]; then
  echo "==> Skipping install (--no-install); $INSTALL_DIR left untouched. Built: $APP_OUT"
else
  echo "==> Installing to $INSTALL_DIR (in place; Dock pin survives)…"
  # Quit ONLY the installed instance (matched by its path) so its files are
  # replaceable — leaves any other build's window alone.
  pkill -f "$INSTALL_DIR/Contents/MacOS/" 2>/dev/null || true
  sleep 1
  rm -rf "$INSTALL_DIR"
  ditto "$APP_OUT" "$INSTALL_DIR"
fi

if [[ "$NOTARIZE" == true ]]; then
  ASSESS_TARGET="$INSTALL_DIR"
  [[ "$NO_INSTALL" == true ]] && ASSESS_TARGET="$APP_OUT"
  echo "==> Gatekeeper assessment (expect: accepted / Notarized Developer ID):"
  spctl -a -t exec -vv "$ASSESS_TARGET" 2>&1 || true
  xcrun stapler validate "$ASSESS_TARGET" 2>&1 || true
fi

if [[ "$PUBLISH" == true ]]; then
  echo "==> Publishing auto-update release…"
  # Version is the source of truth the updater compares against — read it from
  # the same config the built app carries.
  VERSION=$(/usr/bin/grep -m1 '"version"' "$DESKTOP_DIR/src-tauri/tauri.conf.json" \
    | /usr/bin/sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  [[ -n "$VERSION" ]] || { echo "could not read version from tauri.conf.json" >&2; exit 1; }
  case "$(uname -m)" in
    arm64)  ARCH=aarch64 ;;
    x86_64) ARCH=x86_64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
  TARGET=darwin

  # Tar the NOTARIZED, stapled bundle (the staple ticket travels inside it, so the
  # extracted copy stays Gatekeeper-valid). -C keeps the archive rooted at the .app.
  TARBALL="$(dirname "$APP_OUT")/Cassette-${VERSION}.app.tar.gz"
  rm -f "$TARBALL" "$TARBALL.sig"
  echo "==> Archiving $(basename "$TARBALL")…"
  # COPYFILE_DISABLE + --no-mac-metadata: exclude AppleDouble (`._*`) sidecars.
  # ~/Documents is iCloud-synced, which stamps xattrs on the bundle; a plain macOS
  # `tar` then bundles a `._Cassette.app`, and Tauri's updater fails to unpack it
  # ("Operation not permitted") — the whole reason a downloaded update wouldn't
  # install. Both belt-and-suspenders so the archive is always clean.
  COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$TARBALL" \
    -C "$(dirname "$APP_OUT")" "$(basename "$APP_OUT")"

  echo "==> Signing the archive (minisign)…"
  # Reads TAURI_SIGNING_PRIVATE_KEY(_PATH) + _PASSWORD from the environment.
  pnpm -C "$DESKTOP_DIR" tauri signer sign "$TARBALL"
  [[ -f "$TARBALL.sig" ]] || { echo "signer produced no .sig" >&2; exit 1; }

  echo "==> Uploading archive + feed manifest to R2…"
  # The Mac and Windows apps release together (scripts/lib/release-together.ts): the publish may HOLD this build.
  PUBLISH_OUT=$( cd "$SITE_DIR" && pnpm dlx tsx scripts/publish-desktop-release.mts \
      --archive "$TARBALL" --sig "$TARBALL.sig" \
      --version "$VERSION" --target "$TARGET" --arch "$ARCH" \
      --dmg "$DMG" --notes "${RELEASE_NOTES:-}" --built-from "$BUILT_FROM" | tee /dev/stderr )

  rm -f "$TARBALL" "$TARBALL.sig"
  if grep -q "^Held Cassette" <<<"$PUBLISH_OUT"; then
    echo "==> HELD $VERSION ($TARGET-$ARCH): uploaded, not live. Publish Windows $VERSION from the same commit and both go live together."
  else
    echo "==> Published $VERSION ($TARGET-$ARCH). Installed clients will update on next launch."
  fi
fi

echo "==> Done. $INSTALL_DIR"
echo "    Launch:  open \"$INSTALL_DIR\""
