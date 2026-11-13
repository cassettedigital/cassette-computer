#!/usr/bin/env bash
# Build "Cassette Player.app" (Chunk 2) — a double-click, no-Docker bundle.
#
# Lays out the .app, compiles the Swift menu-bar shell, copies the Navidrome +
# sidecar binaries, bundles ffmpeg with its dylibs relocated to @loader_path,
# writes Info.plist + cassette.env (pointing at the EXISTING music/data so the
# paired spine survives), and ad-hoc signs. mpv is bundled IF present (it is
# jukebox-only and off the streaming path).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # apps/cassette-player
APP="$ROOT/native/Cassette Player.app"
CON="$APP/Contents"; MACOS="$CON/MacOS"; RES="$CON/Resources"; BIN="$RES/bin"
NAVIDROME_BIN="$ROOT/navidrome/navidrome"
SIDECAR_BIN="$ROOT/sidecar/cassette-sidecar"

command -v swiftc >/dev/null || { echo "FATAL: swiftc not found"; exit 1; }
command -v go     >/dev/null || { echo "FATAL: go not found (needed to build the sidecar from source)"; exit 1; }
[ -x "$NAVIDROME_BIN" ] || { echo "FATAL: build Navidrome first (cd navidrome && make build)"; exit 1; }

# Build the sidecar FROM SOURCE here — never copy a prebuilt artifact. This is
# the structural fix for the stale-binary bug (a Jun-13 binary once shipped after
# the source had moved on): packaging now always reflects current source, so old
# code can't silently ship again. Verified at the end via string markers.
echo "[0/9] build sidecar from source"
# Stamp the build so the founder can see — in the panel + the logs — exactly which
# sidecar code is live. SHA pins the commit; -dirty flags uncommitted source; the
# HHMMSS suffix makes every rebuild visibly distinct even on the same commit.
SIDECAR_VERSION="$(git -C "$ROOT/sidecar" rev-parse --short HEAD 2>/dev/null || echo nogit)"
git -C "$ROOT/sidecar" diff --quiet 2>/dev/null || SIDECAR_VERSION="${SIDECAR_VERSION}-dirty"
SIDECAR_VERSION="${SIDECAR_VERSION}+$(date +%H%M%S)"
echo "      stamping build $SIDECAR_VERSION"
( cd "$ROOT/sidecar" && go build -ldflags "-X main.buildVersion=${SIDECAR_VERSION}" -o cassette-sidecar . ) || { echo "FATAL: sidecar build failed"; exit 1; }

# Navidrome staleness guard: a full fork rebuild is slow, so we don't force it,
# but we refuse to ship stale engine code silently.
if find "$ROOT/navidrome" -name '*.go' -newer "$NAVIDROME_BIN" -not -path '*/.git/*' 2>/dev/null | grep -q .; then
  echo "WARN: navidrome/*.go is newer than the navidrome binary — rebuild the fork"
  echo "      (cd navidrome && make build) if you changed it."
fi

echo "[1/8] structure"
rm -rf "$APP"; mkdir -p "$MACOS" "$RES" "$BIN"

echo "[2/8] compile Swift shell"
swiftc -O -o "$MACOS/Cassette Player" "$ROOT/native/app/main.swift" -framework AppKit -framework DiskArbitration -framework AVFoundation -framework Network -framework MediaPlayer -framework SwiftUI -framework Accelerate -framework MediaToolbox

echo "[3/8] copy Go binaries"
cp "$NAVIDROME_BIN" "$RES/navidrome"
cp "$SIDECAR_BIN" "$RES/cassette-sidecar"

# ── recursive Mach-O dylib bundler → flat $BIN, all refs @loader_path/<base> ──
PROCESSED="$(mktemp)"   # bash 3.2 has no associative arrays; track basenames here
resolve() { # $1 = dylib ref -> prints a real path or empty
  local ref="$1" base; base="$(basename "$ref")"
  case "$ref" in
    /opt/homebrew/*|/usr/local/*) [ -f "$ref" ] && { echo "$ref"; return; } ;;
  esac
  # @rpath/@loader_path/bare name: search Homebrew lib dirs by basename
  for d in /opt/homebrew/lib /opt/homebrew/opt/*/lib; do
    [ -f "$d/$base" ] && { echo "$d/$base"; return; }
  done
  echo ""
}
bundle_macho() { # $1 = absolute source path of a Mach-O to place in $BIN
  local src="$1" base; base="$(basename "$src")"
  grep -qx "$base" "$PROCESSED" 2>/dev/null && return
  echo "$base" >> "$PROCESSED"
  [ -f "$BIN/$base" ] || cp "$src" "$BIN/$base"
  chmod u+w "$BIN/$base"
  # recurse into non-system deps, then rewrite each ref to @loader_path
  local dep real
  while IFS= read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*|"") continue ;;
    esac
    real="$(resolve "$dep")"
    if [ -n "$real" ]; then
      bundle_macho "$real"
      install_name_tool -change "$dep" "@loader_path/$(basename "$dep")" "$BIN/$base" 2>/dev/null || true
    fi
  done < <(otool -L "$BIN/$base" | tail -n +2 | awk '{print $1}')
  install_name_tool -id "@loader_path/$base" "$BIN/$base" 2>/dev/null || true
}

echo "[4/8] bundle ffmpeg + dylibs"
FFMPEG_SRC="$(command -v ffmpeg || true)"
if [ -n "$FFMPEG_SRC" ]; then
  bundle_macho "$FFMPEG_SRC"
  mv "$BIN/$(basename "$FFMPEG_SRC")" "$BIN/ffmpeg" 2>/dev/null || true
  echo "      ffmpeg bundled ($(ls "$BIN" | wc -l | tr -d ' ') files in bin/)"
else
  echo "      WARN: ffmpeg not found — not bundled"
fi

# mpv: jukebox-only, off the streaming/rip path. Bundle if installed, else skip.
MPV_SRC="$(command -v mpv || true)"
if [ -n "$MPV_SRC" ]; then bundle_macho "$MPV_SRC"; mv "$BIN/$(basename "$MPV_SRC")" "$BIN/mpv" 2>/dev/null || true; echo "      mpv bundled"; else echo "      mpv: not installed — DEFERRED (jukebox-only, not on the phone-streaming/rip path)"; fi

echo "[4b/8] bundle rip CLIs (cd-paranoia, cd-info, flac, fpcalc) + dylibs"
for tool in cd-paranoia cd-info flac fpcalc; do
  SRC="$(command -v "$tool" || true)"
  if [ -n "$SRC" ]; then bundle_macho "$SRC"; echo "      $tool bundled"; else
    echo "      WARN: $tool not on PATH — install libcdio-paranoia + flac + chromaprint (brew) before ripping/AcoustID"; fi
done
echo "      bin/ now has $(ls "$BIN" | wc -l | tr -d ' ') files"

echo "[5/8] Info.plist"
cat > "$CON/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Cassette Player</string>
  <key>CFBundleDisplayName</key><string>Cassette Player</string>
  <key>CFBundleIdentifier</key><string>digital.cassette.player</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Cassette Player</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- Native Playback (Slice 1): AVPlayer streams from the local Navidrome over
       http://localhost:4533. ATS blocks cleartext HTTP by default; scope an
       exception to loopback/.local only (does NOT weaken ATS globally). -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
PLIST

echo "[5b/8] app icon"
# Compile the Icon Composer source into the bundle: a static AppIcon.icns
# (CFBundleIconFile) + Assets.car for the Liquid Glass rendering on macOS 26
# (CFBundleIconName). Source is the shared brand icon in the iOS app dir — single
# source of truth, edit it there to change the icon. Needs Xcode's actool (the CLT
# actool can't compile a .icon); best-effort so a CLT-only build still succeeds — the
# app just falls back to the generic icon.
ICON_SRC="$ROOT/../cassette-player-ios/CassetteIcon2.icon"
ICON_ACTOOL="$(DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun --find actool 2>/dev/null || true)"
if [ -d "$ICON_SRC" ] && [ -n "$ICON_ACTOOL" ]; then
  ICON_TMP="$(mktemp -d)"
  # actool matches --app-icon to the .icon's BASENAME, so stage it as AppIcon.icon —
  # that keeps the bundle's icon conventionally named "AppIcon" regardless of the
  # source filename (CassetteIcon2.icon).
  cp -R "$ICON_SRC" "$ICON_TMP/AppIcon.icon"
  mkdir -p "$ICON_TMP/out"
  if DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer "$ICON_ACTOOL" "$ICON_TMP/AppIcon.icon" \
       --compile "$ICON_TMP/out" --platform macosx --minimum-deployment-target 26.0 \
       --app-icon AppIcon --output-partial-info-plist "$ICON_TMP/partial.plist" \
       --errors --warnings >/dev/null 2>&1 && [ -f "$ICON_TMP/out/AppIcon.icns" ]; then
    cp "$ICON_TMP/out/AppIcon.icns" "$RES/AppIcon.icns"
    ICON_MSG="AppIcon.icns"
    if [ -f "$ICON_TMP/out/Assets.car" ]; then
      cp "$ICON_TMP/out/Assets.car" "$RES/Assets.car"
      ICON_MSG="$ICON_MSG + Assets.car (Liquid Glass)"
    fi
    echo "      ✓ icon compiled → $ICON_MSG"
  else
    echo "      ⚠ actool could not compile the .icon — app shows the generic icon"
  fi
  rm -rf "$ICON_TMP"
else
  echo "      ⚠ no Xcode actool or CassetteIcon2.icon — app icon skipped"
fi

echo "[6/8] cassette.env (canonical non-TCC data/music; creds from .env)"
# A LaunchServices-launched .app cannot read ~/Documents without a TCC grant,
# so the .app's data/music live in non-TCC locations (see setup-data.sh).
DATA_DIR="${CASSETTE_DATA_DIR:-$HOME/Library/Application Support/Cassette Player}"
MUSIC_DIR="${CASSETTE_MUSIC_DIR:-$HOME/Music/Cassette}"

# Bundle the locally-issued cert+key so a freshly-installed .app serves HTTPS
# with nothing re-run. Source = the data-dir certs native/issue-cert.sh writes.
# At runtime the sidecar PREFERS the data-dir copy (renewal needs no rebuild) and
# falls back to this bundled copy (the Swift shell points SIDECAR_BUNDLED_CERT_DIR
# at Resources/certs). Sealed into the bundle by the codesign step below.
CERT_SRC="${SIDECAR_CERT_DIR:-$DATA_DIR/certs}"
mkdir -p "$RES/certs"
if [ -f "$CERT_SRC/cert.pem" ] && [ -f "$CERT_SRC/key.pem" ]; then
  install -m 644 "$CERT_SRC/cert.pem" "$RES/certs/cert.pem"
  install -m 600 "$CERT_SRC/key.pem" "$RES/certs/key.pem"
  echo "      cert:  bundled from $CERT_SRC"
else
  echo "      cert:  NONE at $CERT_SRC — .app serves HTTP until a cert is issued (native/issue-cert.sh)"
fi

ADMIN_USER="admin"; ADMIN_PW=""
ACOUSTID_KEY=""; GNUDB_CLIENT=""; GNUDB_MAIL=""; GNUDB_HOST_VAL=""
if [ -f "$ROOT/.env" ]; then
  ADMIN_USER="$(grep -E '^NAVIDROME_ADMIN_USER=' "$ROOT/.env" | cut -d= -f2- || echo admin)"
  ADMIN_PW="$(grep -E '^NAVIDROME_ADMIN_PW=' "$ROOT/.env" | cut -d= -f2- || echo '')"
  # Disc-identification keys (optional). AcoustID skips cleanly if blank.
  ACOUSTID_KEY="$(grep -E '^ACOUSTID_API_KEY=' "$ROOT/.env" | cut -d= -f2- || echo '')"
  GNUDB_CLIENT="$(grep -E '^GNUDB_CLIENT_NAME=' "$ROOT/.env" | cut -d= -f2- || echo '')"
  GNUDB_MAIL="$(grep -E '^GNUDB_CONTACT_EMAIL=' "$ROOT/.env" | cut -d= -f2- || echo '')"
  GNUDB_HOST_VAL="$(grep -E '^GNUDB_HOST=' "$ROOT/.env" | cut -d= -f2- || echo '')"
fi
cat > "$RES/cassette.env" <<ENV
# Generated by build-app.sh. Points the .app at the canonical (non-TCC) data +
# music. Seed these from the repo spine with native/setup-data.sh.
ND_MUSICFOLDER=$MUSIC_DIR
ND_DATAFOLDER=$DATA_DIR
ND_PORT=4533
ND_DEFAULTTHEME=Cassette
ND_UIWELCOMEMESSAGE=Welcome to Cassette Player
ND_SCANNER_SCHEDULE=1h
ND_SESSIONTIMEOUT=24h
ND_LOGLEVEL=info
# No third-party metadata agents: an outside agent that needed no API key once
# silently served artist imagery to the apps that Cassette has no licence for.
# Artist images come from Cassette's own attributed pipeline instead; empty =
# local files only. (The sidecar also forces ND_ENABLEEXTERNALSERVICES=false.)
ND_AGENTS=
# Canonical host (www): the apex 307-redirects to www, and the HTTP client then
# re-POSTs the whole library payload to www — a doubled round-trip that
# intermittently trips the 30s library-sync timeout. Pointing straight at www
# removes the redirect and the re-POST.
CASSETTE_API_BASE=https://www.cassette.digital
NAVIDROME_BASE_URL=http://localhost:4533
NAVIDROME_ADMIN_USER=$ADMIN_USER
NAVIDROME_ADMIN_PW=$ADMIN_PW
SIDECAR_DATA_DIR=$DATA_DIR
SIDECAR_MUSIC_DIR=$MUSIC_DIR
SIDECAR_PORT=5173
# Disc identification (optional; AcoustID skips cleanly when ACOUSTID_API_KEY is blank).
ACOUSTID_API_KEY=$ACOUSTID_KEY
GNUDB_HOST=$GNUDB_HOST_VAL
GNUDB_CLIENT_NAME=$GNUDB_CLIENT
GNUDB_CONTACT_EMAIL=$GNUDB_MAIL
# Menu "Open Cassette Player" target — the hosted dashboard, NEVER Navidrome's UI.
CASSETTE_DASHBOARD_URL=https://cassette.digital/dashboard/resume
ENV
chmod 600 "$RES/cassette.env"
echo "      data:  $DATA_DIR"
echo "      music: $MUSIC_DIR"

echo "[7/8] sign (unsandboxed, user's own machine)"
# Prefer a stable self-signed identity so macOS TCC grants (disc drive, local
# network) PERSIST across rebuilds — ad-hoc (`--sign -`) changes the code hash
# every build, so TCC treats each rebuild as a new app and re-prompts. Create the
# identity once with native/setup-signing.sh (or Keychain Access → Certificate
# Assistant, type "Code Signing", name "Cassette Code Signing"). Falls back to
# ad-hoc automatically when the identity isn't present, so this is safe either way.
SIGN_ID="-"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Cassette Code Signing"; then
  SIGN_ID="Cassette Code Signing"
  echo "      identity: 'Cassette Code Signing' (stable — TCC grants persist across rebuilds)"
else
  echo "      identity: ad-hoc (TCC re-prompts each rebuild; run native/setup-signing.sh to fix)"
fi
for f in "$BIN"/* "$RES/navidrome" "$RES/cassette-sidecar"; do
  [ -f "$f" ] && codesign --force --timestamp=none --sign "$SIGN_ID" "$f" >/dev/null 2>&1 || true
done
codesign --force --timestamp=none --sign "$SIGN_ID" "$MACOS/Cassette Player" >/dev/null 2>&1 || true
codesign --force --timestamp=none --sign "$SIGN_ID" "$APP" >/dev/null 2>&1 || true

echo "[verify] bundled binary actually contains current code (no stale ship)"
# Demonstrated, not asserted: assert string markers from the TLS-serving and
# disc-detection code are present in the SHIPPED binary. This is exactly the
# failure mode that bit before (a binary with none of this code).
VERIFY_BIN="$RES/cassette-sidecar"
# Capture once and glob-match: `strings | grep -q` would SIGPIPE strings (grep -q
# closes the pipe on first match) and, under `set -o pipefail`, falsely report
# the pipeline as failed even when the marker is present.
VERIFY_SYMS="$(strings "$VERIFY_BIN" 2>/dev/null || true)"
verify_fail=0
# /api/rip/confirm is unique to the multi-signal disc-ID code (c7a67ca) — the
# other markers exist in the OLD binary too, so this is the one that actually
# catches a stale disc-ID ship.
for marker in "serving HTTPS" "permissionState" "/api/rip/reset" "/api/rip/confirm" "api.acoustid.org"; do
  case "$VERIFY_SYMS" in
    *"$marker"*) echo "      ✓ marker present: $marker" ;;
    *) echo "      ✗ MARKER MISSING: $marker"; verify_fail=1 ;;
  esac
done
[ "$verify_fail" = 0 ] || { echo "FATAL: bundled sidecar lacks current-code markers — stale build, refusing to ship"; exit 1; }
if [ -f "$RES/certs/cert.pem" ] && [ -f "$RES/certs/key.pem" ]; then
  echo "      ✓ cert+key bundled (fresh launch serves HTTPS)"
else
  echo "      ⚠ no cert bundled — fresh launch serves HTTP until issue-cert.sh runs"
fi

echo "[8/8] done → $APP"
du -sh "$APP" | awk '{print "      bundle size:", $1}'

# Install to /Applications so the founder can actually find + double-click it,
# and so the findable copy is refreshed every build (never a stale artifact).
INSTALL_DIR="${CASSETTE_INSTALL_DIR:-/Applications}"
if [ -w "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR/Cassette Player.app"
  cp -R "$APP" "$INSTALL_DIR/" && echo "[install] → $INSTALL_DIR/Cassette Player.app (double-click this)"
else
  echo "[install] skipped — $INSTALL_DIR not writable. Launch from: $APP"
fi
