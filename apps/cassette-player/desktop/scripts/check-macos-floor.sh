#!/usr/bin/env bash
#
# Fail when anything inside a built Cassette.app needs a newer macOS than the app
# promises (BUG-773). macOS refuses to start a program whose declared minimum is
# above the running system, so one helper built for the builder's own macOS
# leaves the window up and the music never starting on everyone else's Mac.
#
# Reads each Mach-O's declared minimum (LC_BUILD_VERSION minos, or the older
# LC_VERSION_MIN_MACOSX) and compares it with tauri.conf.json's
# bundle.macOS.minimumSystemVersion. Prints every offender, then exits 1.
#
# Usage: ./scripts/check-macos-floor.sh [path/to/Cassette.app]
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$DESKTOP_DIR/src-tauri/target/release/bundle/macos/Cassette.app}"
[[ -d "$APP" ]] || { echo "no app at $APP" >&2; exit 2; }
FLOOR="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bundle"]["macOS"]["minimumSystemVersion"])' \
  "$DESKTOP_DIR/src-tauri/tauri.conf.json")"

# "13.5" -> 13005, so versions compare as plain integers.
as_int() { local IFS=.; set -- $1; echo $(( ${1:-0} * 1000 + ${2:-0} )); }
FLOOR_INT="$(as_int "$FLOOR")"

BAD=0; SEEN=0
while IFS= read -r -d '' f; do
  /usr/bin/file -b "$f" | /usr/bin/grep -q "^Mach-O" || continue
  SEEN=$((SEEN + 1))
  # One line per architecture slice; the highest one counts.
  MINS="$(/usr/bin/otool -l "$f" 2>/dev/null | /usr/bin/awk '
    /cmd LC_BUILD_VERSION/ {b=1; next}
    /cmd LC_VERSION_MIN_MACOSX/ {v=1; next}
    b && $1=="minos" {print $2; b=0}
    v && $1=="version" {print $2; v=0}')"
  [[ -n "$MINS" ]] || continue
  WORST="$(printf '%s\n' "$MINS" | /usr/bin/sort -t. -k1,1n -k2,2n | /usr/bin/tail -1)"
  if (( $(as_int "$WORST") > FLOOR_INT )); then
    echo "  needs macOS $WORST: ${f#"$APP"/}"
    BAD=$((BAD + 1))
  fi
done < <(/usr/bin/find "$APP/Contents" -type f -perm -u+x -print0 -o -type f \( -name '*.dylib' -o -name '*.node' -o -name '*.so' \) -print0)

if (( BAD > 0 )); then
  echo "FATAL: $BAD of $SEEN programs in the app need a newer macOS than the $FLOOR it promises (BUG-773)." >&2
  exit 1
fi
echo "    ✓ all $SEEN programs run on macOS $FLOOR"
