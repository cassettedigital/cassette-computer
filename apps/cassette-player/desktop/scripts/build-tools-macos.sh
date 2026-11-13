#!/usr/bin/env bash
#
# Build the Mac app's rip and transcode tools from pinned upstream source
# (BUG-773, BUG-780). bundle-macos.sh runs this; it is safe to run on its own.
#
# Why not Homebrew's: its bottles are built for the builder's own macOS, so every
# tool copied from it refused to launch on any Mac older than the builder's (the
# app promises 13.5), and its ffmpeg is a GPL build with x264/x265 and a dozen
# shared libraries. Here each tool is built static, for the app's minimum macOS,
# linking only what ships with macOS:
#
#   ffmpeg        LGPL build (no --enable-gpl, no video encoders), with lame + opus;
#                 lavfi is its only input device (the hub's test-disc mode makes tones)
#   flac          the CLI (GPL-2) on libFLAC (BSD); the rip's encoder
#   fpcalc        chromaprint (MIT tool on an LGPL library); AcoustID fingerprints
#   cd-paranoia   libcdio-paranoia (GPL-3); the rip's reader
#   cd-info       libcdio (GPL-3); disc and drive details
#
# Each source tarball is checked against the sha256 Homebrew's formula pins for the
# same release (an independent record of the upstream file), and kept beside the
# build: the app ships them as the corresponding source for the GPL and LGPL tools.
#
# Output (re-used until a version, a build option or the minimum macOS changes):
#   ~/Library/Caches/cassette-tools/<min-macos>/bin/      the five tools
#   ~/Library/Caches/cassette-tools/<min-macos>/licenses/ each project's licence files
#   ~/Library/Caches/cassette-tools/src/                  the source tarballs
#   ~/Library/Caches/cassette-tools/<min-macos>/VERSIONS.txt
#
# Needs: Xcode command line tools, cmake, pkgconf (brew install cmake pkgconf).
# Usage: ./scripts/build-tools-macos.sh            (prints the output folder last)
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIN_MACOS="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bundle"]["macOS"]["minimumSystemVersion"])' \
  "$DESKTOP_DIR/src-tauri/tauri.conf.json")"
[[ "$MIN_MACOS" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "FATAL: no minimumSystemVersion in tauri.conf.json" >&2; exit 1; }

# name | version | source url | sha256 (Homebrew formula's pin) | licence files
SOURCES=(
  "lame|4.0|https://downloads.sourceforge.net/project/lame/lame/4.0/lame-4.0.tar.gz|3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb|COPYING LICENSE"
  "opus|1.6.1|https://ftp.osuosl.org/pub/xiph/releases/opus/opus-1.6.1.tar.gz|6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1|COPYING"
  "ffmpeg|9.0.2|https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz|8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e|COPYING.LGPLv2.1 LICENSE.md"
  "flac|1.5.0|https://ftp.osuosl.org/pub/xiph/releases/flac/flac-1.5.0.tar.xz|f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920|COPYING.GPL COPYING.Xiph COPYING.LGPL COPYING.FDL"
  "chromaprint|1.6.2|https://github.com/acoustid/chromaprint/releases/download/v1.6.2/chromaprint-1.6.2.tar.gz|d54ada62c16b2db396d3251ec54fc7a58909c163131a1cfcf7fa6407dbc14360|LICENSE.md"
  "libcdio|2.4.0|https://github.com/libcdio/libcdio/releases/download/2.4.0/libcdio-2.4.0.tar.gz|bf7cde63762bb12db7755c395c441e49406fde7e1d9f9a9be7e3b940b1f405d7|COPYING"
  "libcdio-paranoia|10.2+2.0.2|https://github.com/libcdio/libcdio-paranoia/releases/download/release-10.2%2B2.0.2/libcdio-paranoia-10.2+2.0.2.tar.gz|99488b8b678f497cb2e2f4a1a9ab4a6329c7e2537a366d5e4fef47df52907ff6|COPYING"
)
TOOLS=(ffmpeg flac fpcalc cd-paranoia cd-info)

CACHE="$HOME/Library/Caches/cassette-tools"
SRC="$CACHE/src"
OUT="$CACHE/$MIN_MACOS"
PREFIX="$OUT/prefix"
WORK="$OUT/work"
STAMP="$OUT/VERSIONS.txt"

want_stamp() {
  # The script's own fingerprint too, so changed build options rebuild.
  echo "Built for macOS $MIN_MACOS and later, static, by build-tools-macos.sh $(shasum -a 256 "$0" | cut -c1-12), from these upstream sources:"
  for s in "${SOURCES[@]}"; do
    IFS='|' read -r name ver url sha _ <<<"$s"
    echo "$name $ver  $url  sha256 $sha"
  done
}

all_built() {
  local t
  for t in "${TOOLS[@]}"; do [[ -x "$OUT/bin/$t" ]] || return 1; done
}

if [[ -f "$STAMP" ]] && diff -q <(want_stamp) "$STAMP" >/dev/null 2>&1 && all_built; then
  echo "==> [tools] up to date for macOS $MIN_MACOS" >&2
  echo "$OUT"
  exit 0
fi

for t in cmake pkgconf clang make; do
  command -v "$t" >/dev/null || { echo "FATAL: $t not found (brew install cmake pkgconf; xcode-select --install)" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$SRC" "$PREFIX" "$WORK" "$OUT/bin" "$OUT/licenses"
JOBS="$(sysctl -n hw.ncpu)"

# Everything compiles for the app's floor, finds only what this script built
# (never Homebrew's headers, libraries or .pc files), and links statically.
export MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS"
export CC=clang CXX=clang++
export CFLAGS="-O2 -mmacosx-version-min=$MIN_MACOS"
export CXXFLAGS="$CFLAGS"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib -mmacosx-version-min=$MIN_MACOS"
export PKG_CONFIG="pkgconf --static"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_PATH

fetch() { # name -> unpacked source dir on stdout
  local name="$1" s ver url sha lic file dir
  for s in "${SOURCES[@]}"; do
    IFS='|' read -r n ver url sha lic <<<"$s"
    [[ "$n" == "$name" ]] && break
  done
  file="$SRC/$(basename "${url//%2B/+}")"
  if [[ ! -f "$file" ]] || ! shasum -a 256 "$file" | grep -q "^$sha "; then
    echo "    fetching $(basename "$file")" >&2
    curl -fsSL --max-time 600 -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  shasum -a 256 "$file" | grep -q "^$sha " || { echo "FATAL: $(basename "$file") checksum mismatch" >&2; exit 1; }
  dir="$WORK/$name"
  rm -rf "$dir"; mkdir -p "$dir"
  tar -xf "$file" -C "$dir" --strip-components 1
  mkdir -p "$OUT/licenses/$name-$ver"
  for f in $lic; do [[ -f "$dir/$f" ]] && cp "$dir/$f" "$OUT/licenses/$name-$ver/"; done
  ls "$OUT/licenses/$name-$ver" | grep -q . || { echo "FATAL: no licence file found for $name" >&2; exit 1; }
  echo "$dir"
}

autobuild() { # dir, configure args...
  local dir="$1"; shift
  ( cd "$dir" && ./configure --prefix="$PREFIX" --disable-shared --enable-static \
      --disable-dependency-tracking "$@" >"$dir/../$(basename "$dir").configure.log" 2>&1 \
    && make -j"$JOBS" >"$dir/../$(basename "$dir").make.log" 2>&1 \
    && make install >>"$dir/../$(basename "$dir").make.log" 2>&1 ) \
    || { echo "FATAL: $(basename "$dir") build failed; logs in $WORK" >&2; exit 1; }
}

echo "==> [tools] lame…" >&2;  autobuild "$(fetch lame)" --disable-frontend --disable-decoder
echo "==> [tools] opus…" >&2;  autobuild "$(fetch opus)" --disable-doc --disable-extra-programs

echo "==> [tools] ffmpeg (LGPL, audio encoders only)…" >&2
FF_DIR="$(fetch ffmpeg)"
( cd "$FF_DIR" && ./configure --prefix="$PREFIX" --cc=clang \
    --disable-shared --enable-static --pkg-config=pkgconf --pkg-config-flags=--static \
    --extra-cflags="$CFLAGS $CPPFLAGS" --extra-ldflags="$LDFLAGS" --extra-libs=-liconv \
    --disable-autodetect --enable-audiotoolbox --enable-zlib --enable-bzlib --enable-iconv \
    --enable-libmp3lame --enable-libopus \
    --disable-doc --disable-ffplay --disable-ffprobe --disable-network \
    --disable-indevs --enable-indev=lavfi --disable-outdevs \
    --disable-debug \
    --disable-encoders \
    --enable-encoder=aac,aac_at,alac,alac_at,flac,libmp3lame,libopus,opus,vorbis,wavpack,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,mjpeg,png \
    >"$WORK/ffmpeg.configure.log" 2>&1 \
  && make -j"$JOBS" >"$WORK/ffmpeg.make.log" 2>&1 && make install >>"$WORK/ffmpeg.make.log" 2>&1 ) \
  || { echo "FATAL: ffmpeg build failed; logs in $WORK" >&2; exit 1; }
grep -q -- "--enable-gpl\|--enable-nonfree" <("$PREFIX/bin/ffmpeg" -hide_banner -buildconf) \
  && { echo "FATAL: ffmpeg came out GPL or nonfree" >&2; exit 1; }
"$PREFIX/bin/ffmpeg" -hide_banner -L | grep -q "GNU Lesser General Public" \
  || { echo "FATAL: ffmpeg does not report the LGPL" >&2; exit 1; }

echo "==> [tools] flac…" >&2
autobuild "$(fetch flac)" --disable-ogg --disable-cpplibs --disable-doxygen-docs --disable-examples

echo "==> [tools] chromaprint (fpcalc)…" >&2
CP_DIR="$(fetch chromaprint)"
FF_LIBS="$(pkgconf --static --libs libavformat libavcodec libswresample libavutil) -liconv"
( cd "$CP_DIR" && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_TOOLS=ON -DBUILD_SHARED_LIBS=OFF \
    -DFFT_LIB=vdsp -DFFMPEG_ROOT="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS" -DCMAKE_EXE_LINKER_FLAGS="$FF_LIBS" \
    >"$WORK/chromaprint.configure.log" 2>&1 \
  && cmake --build build -j"$JOBS" >"$WORK/chromaprint.make.log" 2>&1 \
  && cmake --install build >>"$WORK/chromaprint.make.log" 2>&1 ) \
  || { echo "FATAL: chromaprint build failed; logs in $WORK" >&2; exit 1; }

echo "==> [tools] libcdio (cd-info)…" >&2
autobuild "$(fetch libcdio)" --disable-cxx --disable-cpp-progs --disable-example-progs \
  --without-libcddb --without-cdda-player --disable-vcd-info --without-versioned-libs

echo "==> [tools] libcdio-paranoia (cd-paranoia)…" >&2
autobuild "$(fetch libcdio-paranoia)" --disable-cxx --disable-example-progs

for t in "${TOOLS[@]}"; do
  cp "$PREFIX/bin/$t" "$OUT/bin/$t"
  # Only macOS's own libraries and frameworks: nothing from the builder's Homebrew.
  if otool -L "$OUT/bin/$t" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' | grep -q .; then
    echo "FATAL: $t links something macOS doesn't ship:" >&2; otool -L "$OUT/bin/$t" >&2; exit 1
  fi
done
rm -rf "$PREFIX" "$WORK"
want_stamp > "$STAMP"
echo "==> [tools] built for macOS $MIN_MACOS" >&2
echo "$OUT"
