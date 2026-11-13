#!/usr/bin/env bash
# Finish an auto-update release from an ALREADY built + notarized app.
#
# The full pipeline is `bundle-macos.sh --rebuild --notarize --publish`, but its
# last step (minisign-signing the archive) needs the updater key's password,
# which only the founder holds - and it runs AFTER a full rebuild + Apple
# notarize round-trip. When a session cuts the build without the password
# (`--rebuild --notarize --no-install`), this script is the short second half:
#
#   1. tar the notarized, stapled Cassette.app (same flags as bundle-macos.sh, so
#      no AppleDouble sidecars sneak in and the updater can unpack it),
#   2. `tauri signer sign` it - prompts for the key password unless
#      TAURI_SIGNING_PRIVATE_KEY_PASSWORD is already in the environment,
#   3. upload archive + feed manifest to R2 (publish-desktop-release.mts, which
#      reads the R2 creds from apps/cassette/.env.local), plus the notarized disk
#      image /download hands to new people when the build made one,
#   4. ask the live feed whether it now offers the new version.
#
# Usage:  ./scripts/finish-release.sh                (version read from tauri.conf.json)
#         RELEASE_NOTES="What changed" ./scripts/finish-release.sh
#
# Nothing here rebuilds, re-signs the .app, or touches /Applications.
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../../.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/cassette"
APP_OUT="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/Cassette.app"

VERSION=$(/usr/bin/grep -m1 '"version"' "$DESKTOP_DIR/src-tauri/tauri.conf.json" \
  | /usr/bin/sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
[[ -n "$VERSION" ]] || { echo "could not read version from tauri.conf.json" >&2; exit 1; }

case "$(uname -m)" in
  arm64)  ARCH=aarch64 ;;
  x86_64) ARCH=x86_64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
TARGET=darwin

[[ -d "$APP_OUT" ]] || { echo "no built app at $APP_OUT - run bundle-macos.sh --rebuild --notarize --no-install first" >&2; exit 1; }

# The built app must carry the version we're about to publish, and a stapled
# notarization ticket - the updater installs nothing Gatekeeper would refuse.
BUILT_VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP_OUT/Contents/Info.plist")
[[ "$BUILT_VERSION" == "$VERSION" ]] || { echo "built app is $BUILT_VERSION but tauri.conf.json says $VERSION - rebuild first" >&2; exit 1; }
echo "==> Checking the notarization staple on the built app…"
xcrun stapler validate "$APP_OUT"

# The same release rules bundle-macos.sh --notarize enforces, checked again on the
# exact app about to go out, in case it came from an older build (BUG-785).
echo "==> Checking the built app is fit to ship…"
"$DESKTOP_DIR/scripts/check-macos-floor.sh" "$APP_OUT"
CLOUD_LINE="$(/usr/bin/grep -E '^CASSETTE_CLOUD_BASE=' "$APP_OUT/Contents/Resources/server/.env" || true)"
[[ "$CLOUD_LINE" == "CASSETTE_CLOUD_BASE=https://www.cassette.digital" ]] \
  || { echo "built app talks to '${CLOUD_LINE#*=}', not production - rebuild" >&2; exit 1; }
for tool in ffmpeg flac fpcalc cd-paranoia cd-info; do
  [[ -x "$APP_OUT/Contents/Resources/bin/$tool" ]] || { echo "built app has no $tool - it couldn't rip; rebuild" >&2; exit 1; }
done
[[ -s "$APP_OUT/Contents/Resources/Licenses/THIRD-PARTY-NOTICES.txt" ]] \
  || { echo "built app has no Licenses folder (BUG-780) - rebuild" >&2; exit 1; }

# Signing key: default to the founder's key file; the password is prompted for
# by `tauri signer sign` when TAURI_SIGNING_PRIVATE_KEY_PASSWORD is unset.
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.cassette/updater.key"
fi

TARBALL="$(dirname "$APP_OUT")/Cassette-${VERSION}.app.tar.gz"
rm -f "$TARBALL" "$TARBALL.sig"
echo "==> Archiving $(basename "$TARBALL")…"
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$TARBALL" \
  -C "$(dirname "$APP_OUT")" "$(basename "$APP_OUT")"

echo "==> Signing the archive (minisign) - enter the updater key password if asked…"
pnpm -C "$DESKTOP_DIR" tauri signer sign "$TARBALL"
[[ -f "$TARBALL.sig" ]] || { echo "signer produced no .sig" >&2; exit 1; }

# The disk image bundle-macos.sh --notarize built beside the app, if it is this
# build's: it must be newer than the app it wraps, and stapled.
DMG="$(dirname "$APP_OUT")/Cassette.dmg"
DMG_ARGS=()
if [[ -f "$DMG" && "$DMG" -nt "$APP_OUT/Contents/Info.plist" ]]; then
  xcrun stapler validate "$DMG"
  DMG_ARGS=(--dmg "$DMG")
else
  echo "    (no disk image from this build; /download keeps the previous one)"
fi

echo "==> Uploading archive + feed manifest to R2…"
( cd "$WEB_DIR" && pnpm dlx tsx scripts/publish-desktop-release.mts \
    --archive "$TARBALL" --sig "$TARBALL.sig" \
    --version "$VERSION" --target "$TARGET" --arch "$ARCH" \
    ${DMG_ARGS[@]+"${DMG_ARGS[@]}"} --notes "${RELEASE_NOTES:-}" --built-from "$(git -C "$REPO_ROOT" rev-parse HEAD)" )

rm -f "$TARBALL" "$TARBALL.sig"

echo "==> Asking the live feed (as an older client would)…"
PREV="0.0.0"
curl -s -o /dev/null -w "feed for a $PREV client -> HTTP %{http_code} (200 = update offered)\n" \
  "https://www.cassette.digital/api/desktop/update/$TARGET/$ARCH/$PREV" || true

echo "==> Published $VERSION ($TARGET-$ARCH). Open Cassette and use the UPDATE AVAILABLE pill (it also checks every 30 minutes)."
