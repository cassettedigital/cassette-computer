#!/bin/bash
# Double-click to open the INSTALLED Cassette app pointed at the local dev
# server (:3100) instead of its bundled UI. Start `pnpm --filter cassette dev`
# first. Close this Terminal window (or Ctrl-C) to quit the app.
#
# The shipped app ignores all of this — it only reads CASSETTE_UI_URL, which is
# never set in normal (double-click-the-app) use.
exec env CASSETTE_UI_URL="${CASSETTE_UI_URL:-http://localhost:3100}" \
  "/Applications/Cassette.app/Contents/MacOS/cassette-desktop"
