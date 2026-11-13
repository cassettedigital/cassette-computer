#!/usr/bin/env bash
#
# Build the Cassette desktop app for Windows: an unsigned NSIS installer (the Windows port, 2026-11-07,
# docs/CASSETTE_WINDOWS_PORT_PLAN_2026-11-07.md). The Windows twin of bundle-macos.sh, run with Git Bash on a
# Windows computer (GitHub's hosted Windows machines have it; .github/workflows/windows-desktop.yml runs this).
#
# Everything is built from source or fetched from its own publisher at a pinned version, never taken from the
# building computer: the UI server (Next.js standalone), the hub (Go), Navidrome from our fork (never the stock
# download, so no Last.fm or Deezer), an official Node, mpv for playback, an LGPL ffmpeg for transcodes, and the
# disc tools.
#
# What it never carries: a database address, an auth secret, a signing key. The UI is built in Next's
# compile-only mode, so no page is drawn from the database at build time (BUG-593); a stand-in token puts the
# build in token mode and never leaves this machine (checked below). The installer is not code-signed:
# Windows shows its "protected your PC" screen, which is expected for the testers' builds.
#
# Needs: Git Bash, pnpm, Node 22+, Go, Rust (MSVC), 7-Zip, and MSYS2's MinGW gcc (Navidrome's database driver is C)
# at $MSYS2_ROOT. NAVIDROME_REF is the fork commit to build (the release pins it).
#
# Usage:  NAVIDROME_REF=<sha> MSYS2_ROOT=/c/msys64 ./scripts/bundle-windows.sh
set -euo pipefail

: "${NAVIDROME_REF:?set NAVIDROME_REF to the fork commit to build}"
MSYS2_ROOT="$(cygpath -u "${MSYS2_ROOT:-C:\\msys64}" 2>/dev/null || echo "${MSYS2_ROOT:-/c/msys64}")"
# MinGW's own tools, called by full path: Git Bash has a /mingw64 of its own that is not MSYS2's.
MINGW_BIN="$MSYS2_ROOT/mingw64/bin"
NAVIDROME_URL="https://github.com/cassettedigital/cassette-navidrome"
CLOUD="https://www.cassette.digital"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../../.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/cassette"
NATIVE_DIR="$REPO_ROOT/apps/cassette-player"
DISTDIR=".next-desktop"
STANDALONE="$WEB_DIR/$DISTDIR/standalone"
RES="$DESKTOP_DIR/src-tauri/resources-win"
BIN="$RES/bin"
WORK="${RUNNER_TEMP:-$DESKTOP_DIR/.bundle-windows}/cassette-win"
WORK="$(cygpath -u "$WORK" 2>/dev/null || echo "$WORK")"

# A missing optional tool is a flag, not a failed build: the testers' build still starts without it.
FLAGS=()
flag() { FLAGS+=("$1"); echo "FLAG: $1"; }
fetch() { curl -fsSL --retry 3 --max-time 600 -o "$2" "$1"; }
unpack() { 7z x -y -o"$2" "$1" >/dev/null; }
# Copy into $2 every MinGW DLL that $1 needs, and the DLLs those need in turn. Windows' own DLLs are not in
# MinGW's folder, so they are skipped by themselves.
with_dlls() {
  local dll
  for dll in $("$MINGW_BIN/objdump.exe" -p "$1" 2>/dev/null | awk '/DLL Name:/ { print $3 }'); do
    if [ -f "$MINGW_BIN/$dll" ] && [ ! -f "$2/$dll" ]; then
      cp "$MINGW_BIN/$dll" "$2/"
      with_dlls "$MINGW_BIN/$dll" "$2"
    fi
  done
}

rm -rf "$RES" "$WORK"
mkdir -p "$RES" "$BIN" "$WORK"

# ─── The UI server ──────────────────────────────────────────────────────────────────────────────────────────
echo "==> [ui] Next.js standalone, compile-only, no database…"
STAND_IN="cassette-build-stand-in-$(date +%s)"
( cd "$WEB_DIR" && env -u DATABASE_URL -u DATABASE_URL_APP \
    DESKTOP_BUILD=1 NEXT_PUBLIC_SIDECAR_URL=/sidecar \
    CASSETTE_PLAYER_TOKEN="$STAND_IN" CASSETTE_CLOUD_BASE=http://127.0.0.1:9 \
    pnpm exec next build --experimental-build-mode=compile )
[ -f "$STANDALONE/apps/cassette/server.js" ] || { echo "FATAL: no standalone server.js"; exit 1; }

echo "==> [ui] copy the server tree (links followed, so the installer carries real files)…"
cp -RL "$STANDALONE" "$RES/server"
rm -rf "$RES/server/apps/cassette/$DISTDIR/static" "$RES/server/apps/cassette/public"
cp -R "$WEB_DIR/$DISTDIR/static" "$RES/server/apps/cassette/$DISTDIR/static"
cp -R "$WEB_DIR/public" "$RES/server/apps/cassette/public"
# No source maps in the app (BUG-1009): a browser source map carries the website's original code. The
# desktop build makes none (next.config.ts); this removes any that slip in.
find "$RES/server/apps/cassette/$DISTDIR" -name '*.map' -delete
# The shipped server's settings: the cloud's address and nothing else (the same rule as bundle-macos.sh).
printf 'CASSETTE_CLOUD_BASE=%s\n' "$CLOUD" > "$RES/server/.env"
if grep -rqF "$STAND_IN" "$RES/server"; then
  echo "FATAL: the build's stand-in token ended up in the server tree"; exit 1
fi
# Windows paths stop at 260 characters in many tools, the installer included. Report the longest one under the
# install folder (about 40 characters of C:\Users\<name>\AppData\Local\Cassette\ come before it).
LONGEST="$(cd "$RES" && find . -type f | awk '{ print length($0) }' | sort -n | tail -1)"
echo "    longest path inside the app: $LONGEST characters"
[ "$LONGEST" -lt 200 ] || flag "a file path inside the app is $LONGEST characters; Windows may refuse it"

# ─── The hub ────────────────────────────────────────────────────────────────────────────────────────────────
echo "==> [hub] build the sidecar…"
SIDECAR_VERSION="$(git -C "$NATIVE_DIR/sidecar" rev-parse --short HEAD 2>/dev/null || echo nogit)-win+$(date +%H%M%S)"
( cd "$NATIVE_DIR/sidecar" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "-X main.buildVersion=$SIDECAR_VERSION" -o "$RES/cassette-sidecar.exe" . )
for marker in "/api/rip/reset" "/api/sync/pending" "lanTlsPin"; do
  grep -aqF "$marker" "$RES/cassette-sidecar.exe" || { echo "FATAL: the sidecar is missing '$marker' (stale build)"; exit 1; }
done

echo "==> [hub] Navidrome from the fork at ${NAVIDROME_REF:0:12}…"
ND_SRC="$WORK/navidrome"
git init -q "$ND_SRC"
git -C "$ND_SRC" remote add origin "$NAVIDROME_URL"
git -C "$ND_SRC" fetch -q --depth 1 origin "$NAVIDROME_REF"
git -C "$ND_SRC" checkout -q FETCH_HEAD
ND_TAG="$(git -C "$ND_SRC" describe --tags --abbrev=0 2>/dev/null || echo untagged)"
# Its own web pages are left out: nothing reaches them (the hub's gateway passes only /rest/ and /ping), and a
# stale build of them is the one place Last.fm or Deezer names could come back. The embed needs a file there.
[ -f "$ND_SRC/ui/build/.gitkeep" ] || touch "$ND_SRC/ui/build/.gitkeep"
( cd "$ND_SRC" && PATH="$MINGW_BIN:$PATH" CGO_ENABLED=1 CC=gcc GOOS=windows GOARCH=amd64 \
    go build -trimpath -tags=netgo,sqlite_fts5 \
    -ldflags "-X github.com/navidrome/navidrome/consts.gitSha=${NAVIDROME_REF:0:8} -X github.com/navidrome/navidrome/consts.gitTag=${ND_TAG}-cassette" \
    -o "$RES/navidrome.exe" . )
# No Last.fm and no Deezer, ever (CLAUDE.md; Patch 009, BUG-864).
# (grep finds nothing in a clean binary and says so with a failing status, hence the || true.)
BANNED="$( { LC_ALL=C grep -aoiE 'audioscrobbler|last[._-]?fm|deezer|dzcdn' "$RES/navidrome.exe" || true; } | wc -l | tr -d ' ')"
[ "$BANNED" = "0" ] || { echo "FATAL: Navidrome mentions Last.fm or Deezer $BANNED times"; exit 1; }
# A program built with MinGW may need its runtime DLLs: into bin/, which the shell puts first on the hub's PATH.
with_dlls "$RES/navidrome.exe" "$BIN"

# ─── Node for the UI server ─────────────────────────────────────────────────────────────────────────────────
NODE_VERSION="v24.22.2"
echo "==> [ui] Node $NODE_VERSION (official build, checked against Node's published checksum)…"
NODE_ZIP="node-$NODE_VERSION-win-x64.zip"
fetch "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP" "$WORK/$NODE_ZIP"
fetch "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
WANT="$(awk -v f="$NODE_ZIP" '$2 == f { print $1 }' "$WORK/SHASUMS256.txt")"
GOT="$(sha256sum "$WORK/$NODE_ZIP" | awk '{ print $1 }')"
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { echo "FATAL: Node checksum mismatch"; exit 1; }
unpack "$WORK/$NODE_ZIP" "$WORK"
cp "$WORK/node-$NODE_VERSION-win-x64/node.exe" "$RES/node.exe"
"$RES/node.exe" --version

# ─── Playback: mpv (your call 3; the first build plays through it) ──────────────────────────────────────────
# zhongfly keeps only recent builds (a pinned one was gone by the first hosted run), so take the newest plain
# x86-64 player and check it against the checksum list published beside it. The build's name and checksum are
# printed for the record.
echo "==> [play] mpv (zhongfly/mpv-winbuild, newest plain x86-64 build)…"
MPV_REL="$(gh api repos/zhongfly/mpv-winbuild/releases/latest --jq '.tag_name' 2>/dev/null | tr -d '\r' || true)"
MPV_NAME="$(gh api repos/zhongfly/mpv-winbuild/releases/latest --jq '.assets[].name' 2>/dev/null | tr -d '\r' \
  | grep -E '^mpv-x86_64-[0-9]{8}-git-[0-9a-f]+\.7z$' | head -1 || true)"
MPV_BASE="https://github.com/zhongfly/mpv-winbuild/releases/download/$MPV_REL"
if [[ "$MPV_REL" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]+$ ]] && [ -n "$MPV_NAME" ] \
   && fetch "$MPV_BASE/$MPV_NAME" "$WORK/mpv.7z" && fetch "$MPV_BASE/sha256.txt" "$WORK/mpv-sha256.txt" \
   && grep -qiF "$(sha256sum "$WORK/mpv.7z" | cut -c1-64)" "$WORK/mpv-sha256.txt" \
   && unpack "$WORK/mpv.7z" "$WORK/mpv"; then
  echo "    $MPV_NAME (checksum matches the published list)"
  cp "$(find "$WORK/mpv" -name mpv.exe | head -1)" "$BIN/mpv.exe"
  "$BIN/mpv.exe" --no-config --version | head -1 || flag "mpv.exe won't start"
  echo "    sha256 $(sha256sum "$BIN/mpv.exe" | cut -c1-64)"
else
  flag "mpv not staged: no playback in this build"
fi

# ─── Transcodes: an LGPL ffmpeg, like the Mac's (BUG-780) ───────────────────────────────────────────────────
echo "==> [hub] ffmpeg (BtbN, LGPL, release 7.1)…"
# A release line, LGPL, not the shared-library build; 7.1 first, else the newest line BtbN still builds.
FF_NAMES="$(gh api repos/BtbN/FFmpeg-Builds/releases/latest --jq '.assets[].name' 2>/dev/null || true)"
FF_NAME="$(echo "$FF_NAMES" | grep -E '^ffmpeg-n7\.1-latest-win64-lgpl-7\.1\.zip$' | head -1 || true)"
[ -n "$FF_NAME" ] || FF_NAME="$(echo "$FF_NAMES" | grep -E '^ffmpeg-n[0-9.]+-latest-win64-lgpl-[0-9.]+\.zip$' | sort -V | tail -1 || true)"
FF_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$FF_NAME"
if [ -n "$FF_NAME" ] && fetch "$FF_URL" "$WORK/ffmpeg.zip" && unpack "$WORK/ffmpeg.zip" "$WORK/ffmpeg"; then
  cp "$(find "$WORK/ffmpeg" -name ffmpeg.exe | head -1)" "$BIN/ffmpeg.exe"
  echo "    $(basename "$FF_URL") sha256 $(sha256sum "$BIN/ffmpeg.exe" | cut -c1-64)"
else
  flag "ffmpeg not staged: Navidrome can't convert formats in this build"
fi

# ─── Discs (your call 4): staged when they come, never required ─────────────────────────────────────────────
echo "==> [rip] fpcalc, flac, cd-paranoia, cd-info…"
if fetch "https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-windows-x86_64.zip" "$WORK/fpcalc.zip" \
   && unpack "$WORK/fpcalc.zip" "$WORK/fpcalc"; then
  cp "$(find "$WORK/fpcalc" -name fpcalc.exe | head -1)" "$BIN/fpcalc.exe"
else
  flag "fpcalc not staged"
fi
for tool in flac cd-paranoia cd-info; do
  src="$MINGW_BIN/$tool.exe"
  if [ -f "$src" ]; then
    cp "$src" "$BIN/"
    with_dlls "$src" "$BIN"
  else
    flag "$tool not staged: ripping off in this build"
  fi
done

# ─── The hub's settings ─────────────────────────────────────────────────────────────────────────────────────
echo "==> [hub] cassette.env…"
# %VAR% folders are resolved on the person's own computer at launch (lib.rs expand_windows_env_tokens). The hub's
# data goes in the local app data (never the roaming profile: a music library's database must not follow a
# roaming account around). The music folder matches the Mac's place, Music\Cassette.
cat > "$RES/cassette.env" <<'ENV'
# Generated by bundle-windows.sh. Local settings only: no password, no secret. Each install mints its own
# Navidrome admin in its data folder (sidecar admin_setup.go).
ND_MUSICFOLDER=%USERPROFILE%\Music\Cassette
ND_DATAFOLDER=%LOCALAPPDATA%\Cassette Player
# Navidrome listens on this computer only, on 4534; the hub answers the phones on the Wi-Fi at 4533, encrypted
# (sidecar lan-tls.go, BUG-870).
ND_PORT=4534
CASSETTE_LAN_PORT=4533
ND_DEFAULTTHEME=Cassette
ND_SCANNER_SCHEDULE=1h
ND_SESSIONTIMEOUT=24h
ND_LOGLEVEL=info
ND_AGENTS=
ND_ENABLEEXTERNALSERVICES=false
ND_ENABLEINSIGHTSCOLLECTOR=false
CASSETTE_API_BASE=https://www.cassette.digital
NAVIDROME_BASE_URL=http://127.0.0.1:4534
NAVIDROME_ADMIN_USER=cassette
SIDECAR_DATA_DIR=%LOCALAPPDATA%\Cassette Player
SIDECAR_MUSIC_DIR=%USERPROFILE%\Music\Cassette
SIDECAR_PORT=5173
ACOUSTID_API_KEY=
GNUDB_HOST=
GNUDB_CLIENT_NAME=
GNUDB_CONTACT_EMAIL=
ENV
mkdir -p "$RES/certs" && : > "$RES/certs/.keep"

# ─── The shell and the installer ────────────────────────────────────────────────────────────────────────────
echo "==> [shell] Tauri build (NSIS installer; tauri.windows.conf.json merges in by itself)…"
pnpm -C "$DESKTOP_DIR" install --ignore-workspace --frozen-lockfile
pnpm -C "$DESKTOP_DIR" tauri build

echo "==> Built:"
ls -la "$DESKTOP_DIR/src-tauri/target/release/bundle/nsis/"
if [ "${#FLAGS[@]}" -gt 0 ]; then
  echo "==== ${#FLAGS[@]} flag(s) ===="
  printf ' - %s\n' "${FLAGS[@]}"
fi
