#!/usr/bin/env bash
# Stop the native Cassette Player stack started by run-native.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNDIR="$ROOT/native/run"
for svc in sidecar navidrome; do
  pf="$RUNDIR/$svc.pid"
  if [ -f "$pf" ]; then
    pid="$(cat "$pf")"
    if kill -0 "$pid" 2>/dev/null; then echo "stopping $svc (pid $pid)"; kill "$pid" 2>/dev/null || true; fi
    rm -f "$pf"
  fi
done
echo "done."
