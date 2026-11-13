#!/bin/bash
# Double-click to rebuild + re-notarize the installed Cassette app with the
# latest committed code (~5-7 min). It quits the running app, rebuilds the UI,
# Developer-ID signs, notarizes with Apple, staples, and reinstalls in place
# (your Dock pin survives). Close this Terminal window when it prints "Done".
#
# You usually DON'T need this: to iterate on the UI, open "Cassette Dev" instead
# — it points at the :3100 dev server and hot-reloads with no rebuild. Only run
# this to sync the pinned app to the latest code, or to cut a build to share.
cd "$(dirname "$0")" || exit 1
if ps aux | grep -iE "cd-paranoia|cdparanoia" | grep -v grep >/dev/null; then
  echo "⚠️  A CD rip is in progress — not rebuilding (it would quit the app mid-rip)."
  echo "    Run this again once the rip finishes."
  exit 1
fi
echo "Rebuilding + notarizing Cassette — this takes ~5-7 minutes. You can walk away."
exec /bin/bash scripts/bundle-macos.sh --rebuild --notarize
