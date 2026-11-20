#!/usr/bin/env bash
# seed-hub-radio.sh — put the starter set of radio stations into THIS Mac's
# Cassette hub (its bundled music server), with the registry's clean names and
# the stations' own logos, so the phones' Radio screen is dressed properly.
#
# Stop-gap for the founder's test (docs/reference/CASSETTE_RADIO.md, order of
# work step 3 is the real mechanism). Run it by hand, on the Mac that runs the
# hub, while Cassette.app is open, from the repo root:
#
#     bash apps/cassette-player/scripts/seed-hub-radio.sh            # add / rename / upload logos
#     bash apps/cassette-player/scripts/seed-hub-radio.sh --prune    # ...and remove stations not in the set (hand-added ones too)
#     bash apps/cassette-player/scripts/seed-hub-radio.sh --list
#     bash apps/cassette-player/scripts/seed-hub-radio.sh --delete <id>
#
# Where the data comes from: apps/cassette-player/scripts/radio-catalog.json,
# exported from the ONE registry (apps/cassette/src/config/radio.ts) by
# `pnpm exec tsx scripts/export-radio-catalog.ts` in apps/cassette. The set of
# stations that go on the hub is STARTER below (by registry slug).
#
# What it does: reads the music server's admin username and password from the
# RUNNING sidecar's environment (the hub sets them; nothing is stored or
# printed), signs in the way the hub itself does, then for each starter
# station: creates it if missing (matched on stream URL), renames it to the
# registry name if it differs, and uploads the logo once. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CATALOG="$ROOT/apps/cassette-player/scripts/radio-catalog.json"
# the installed hub's own address (its bundle's cassette.env: Navidrome moved to 4534), else the dev default
ND_ENV="$(grep -E '^NAVIDROME_BASE_URL=' /Applications/Cassette.app/Contents/Resources/cassette.env 2>/dev/null | cut -d= -f2- || true)"
ND="${NAVIDROME_BASE_URL:-${ND_ENV:-http://localhost:4533}}"

# The phone set: the whole registry by default (the phone groups it into
# sections). Narrow it with RADIO_STARTER="slug slug ..." in the environment.
STARTER="${RADIO_STARTER:-all}"

[ -f "$CATALOG" ] || { echo "Missing $CATALOG. In apps/cassette run: pnpm exec tsx scripts/export-radio-catalog.ts" >&2; exit 1; }

# ── credentials: exported NAVIDROME_ADMIN_USER / NAVIDROME_ADMIN_PW win; else both
# come from the running sidecar's environment (your own process, your own machine).
USER_="${NAVIDROME_ADMIN_USER:-}"
PW="${NAVIDROME_ADMIN_PW:-}"
if [ -z "$PW" ] || [ -z "$USER_" ]; then
  PID="$(pgrep -f 'Cassette.app/Contents/Resources/cassette-sidecar' | head -1 || true)"
  [ -n "$PID" ] || { echo "The Cassette hub is not running (no cassette-sidecar process). Open Cassette.app and try again." >&2; exit 1; }
  ENV_="$(ps -E -p "$PID" -o command= | tr ' ' '\n')"
  [ -n "$USER_" ] || USER_="$(printf '%s\n' "$ENV_" | grep '^NAVIDROME_ADMIN_USER=' | cut -d= -f2- || true)"
  [ -n "$PW" ] || PW="$(printf '%s\n' "$ENV_" | grep '^NAVIDROME_ADMIN_PW=' | cut -d= -f2- || true)"
fi
USER_="${USER_:-cassette}"
# The bundled hub mints its own password once and keeps it in its data folder (sidecar/admin_setup.go), so the
# sidecar's environment no longer carries it: read the file, never print it.
PW_FILE="${CASSETTE_DATA_DIR:-$HOME/Library/Application Support/Cassette Player}/navidrome-admin-password"
[ -n "$PW" ] || { [ -r "$PW_FILE" ] && PW="$(head -1 "$PW_FILE" | tr -d '\r\n')"; } || true
[ -n "$PW" ] || { echo "Could not find the music server's admin password in the sidecar's environment." >&2; exit 1; }

echo "Signing in to the hub's music server as '$USER_'."
TOKEN="$(python3 - "$ND" "$USER_" "$PW" <<'PY'
import sys, json, urllib.request
nd, u, p = sys.argv[1:4]
req = urllib.request.Request(nd + "/auth/login", data=json.dumps({"username": u, "password": p}).encode(), headers={"content-type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print(json.load(r).get("token", ""))
except Exception as e:
    print("")
PY
)"
[ -n "$TOKEN" ] || { echo "Sign-in failed (wrong username or password for the music server)." >&2; exit 1; }
AUTH=(-H "x-nd-authorization: Bearer $TOKEN")

api() { curl -s --max-time 15 "${AUTH[@]}" "$@"; }

list_json() { api "$ND/api/radio?_start=0&_end=500"; }

if [ "${1:-}" = "--list" ]; then
  list_json | python3 -c 'import sys,json
L=json.load(sys.stdin)
for s in L: print(s["id"], " ", s["name"], " ", s["streamUrl"], " ", "logo" if s.get("uploadedImage") else "-")
print(len(L), "station(s)")'
  exit 0
fi
if [ "${1:-}" = "--delete" ]; then
  [ -n "${2:-}" ] || { echo "usage: --delete <id> [<id>...]" >&2; exit 1; }
  # several ids on one sign-in: the music server refuses sign-ins after a few in a row
  for id in "${@:2}"; do api -X DELETE "$ND/api/radio/$id" -o /dev/null -w "delete $id → HTTP %{http_code}\n"; done
  exit 0
fi
PRUNE=0; [ "${1:-}" = "--prune" ] && PRUNE=1

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
list_json > "$TMP/existing.json"

# The plan, computed in one place (unit-separated: a tab would let an empty
# field collapse under `read` and shift the id into the wrong column): for each starter slug → create | rename | keep,
# plus the logo to upload when the station has none yet, plus prune candidates.
python3 - "$CATALOG" "$TMP/existing.json" "$STARTER" "$PRUNE" > "$TMP/plan.tsv" <<'PY'
import sys, json
cat = json.load(open(sys.argv[1]))["stations"]
existing = json.load(open(sys.argv[2]))
starter = [s["slug"] for s in cat] if sys.argv[3].strip() == "all" else sys.argv[3].split()
prune = sys.argv[4] == "1"
by_slug = {s["slug"]: s for s in cat}
by_url = {s["streamUrl"]: s for s in existing}
want_urls = set()
for slug in starter:
    s = by_slug.get(slug)
    if not s:
        print("\x1f".join(["missing-in-registry", slug, "", "", "", ""])); continue
    want_urls.add(s["streamUrl"])
    ex = by_url.get(s["streamUrl"])
    img = s.get("image") or ""
    if ex is None:
        print("\x1f".join(["create", s["name"], s["streamUrl"], s.get("homepage") or "", img, ""]))
    else:
        op = "rename" if ex["name"] != s["name"] else "keep"
        needs_logo = img and not ex.get("uploadedImage")
        print("\x1f".join([op, s["name"], s["streamUrl"], s.get("homepage") or "", img if needs_logo else "", ex["id"]]))
        # the registry stopped showing a logo for this station: take ours down too
        if not img and ex.get("uploadedImage"):
            print("\x1f".join(["unlogo", s["name"], s["streamUrl"], "", "", ex["id"]]))
if prune:
    for ex in existing:
        if ex["streamUrl"] not in want_urls:
            print("\x1f".join(["prune", ex["name"], ex["streamUrl"], "", "", ex["id"]]))
PY

upload_logo() { # id, image url
  local id="$1" url="$2" ext f local_art
  ext="${url##*.}"; ext="${ext%%\?*}"; case "$ext" in png|jpg|jpeg|webp) ;; *) ext="jpg";; esac
  f="$TMP/logo.$ext"
  # Marks we keep ourselves (apps/cassette/public/radio-art) come straight from
  # the repo, so they work before the site that serves them is deployed.
  local_art="$ROOT/apps/cassette/public/radio-art/${url##*/radio-art/}"
  if [[ "$url" == */radio-art/* && -f "$local_art" ]]; then
    cp "$local_art" "$f"
  else
    curl -sf --max-time 20 -L -A "Mozilla/5.0" -o "$f" "$url" || { echo "   logo download failed"; return; }
  fi
  api -X POST "$ND/api/radio/$id/image" -F "image=@$f" -o /dev/null -w "   logo → HTTP %{http_code}\n"
}

while IFS=$'\x1f' read -r op name url home img id; do
  case "$op" in
    create)
      printf '%-28s create: ' "$name"
      newid="$(api -X POST "$ND/api/radio" -H "content-type: application/json" \
        -d "$(python3 -c 'import sys,json; print(json.dumps({"name": sys.argv[1], "streamUrl": sys.argv[2], "homePageUrl": sys.argv[3]}))' "$name" "$url" "$home")" \
        | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
      if [ -n "$newid" ]; then echo "ok ($newid)"; [ -n "$img" ] && upload_logo "$newid" "$img"; else echo "FAILED"; fi ;;
    rename)
      printf '%-28s rename: ' "$name"
      api -X PUT "$ND/api/radio/$id" -H "content-type: application/json" \
        -d "$(python3 -c 'import sys,json; print(json.dumps({"id": sys.argv[1], "name": sys.argv[2], "streamUrl": sys.argv[3], "homePageUrl": sys.argv[4]}))' "$id" "$name" "$url" "$home")" \
        -o /dev/null -w "HTTP %{http_code}\n"
      [ -n "$img" ] && upload_logo "$id" "$img" ;;
    keep)
      printf '%-28s already there\n' "$name"
      [ -n "$img" ] && upload_logo "$id" "$img" ;;
    prune)
      printf '%-28s remove (not in the set): ' "$name"
      api -X DELETE "$ND/api/radio/$id" -o /dev/null -w "HTTP %{http_code}\n" ;;
    unlogo)
      printf '%-28s logo off (our tile instead): ' "$name"
      api -X DELETE "$ND/api/radio/$id/image" -o /dev/null -w "HTTP %{http_code}\n" ;;
    missing-in-registry)
      printf '%-28s not in the registry, skipped\n' "$name" ;;
  esac
done < "$TMP/plan.tsv"

echo
echo "Done. On the iPhone: Library, the title dropdown, Radios, then pull to refresh."
