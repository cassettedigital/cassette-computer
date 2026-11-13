#!/bin/bash
# Cassette Player — Update Upstream Script
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# Pulls the latest Navidrome changes into the cloned repo and re-applies
# our patches. Run this periodically to stay current with upstream.
#
# Run from: apps/cassette-player/
# Usage: pnpm update-upstream   OR   bash scripts/update-upstream.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NAVIDROME_DIR="./navidrome"

echo ""
echo "🎵 Cassette Player — Update Upstream"
echo "======================================"
echo ""

if [ ! -d "$NAVIDROME_DIR/.git" ]; then
  echo "❌ Navidrome not cloned. Run 'pnpm setup' first."
  exit 1
fi

# ─── Record current state ─────────────────────────────────────────────────────

BEFORE_VERSION=$(cd "$NAVIDROME_DIR" && git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
BEFORE_HASH=$(cd "$NAVIDROME_DIR" && git rev-parse --short HEAD)
echo "Before: $BEFORE_VERSION ($BEFORE_HASH)"

# ─── Pull upstream ────────────────────────────────────────────────────────────

echo "📥 Fetching upstream changes..."
(cd "$NAVIDROME_DIR" && git fetch origin && git merge --ff-only origin/main) || {
  echo ""
  echo "⚠️  Fast-forward merge failed — upstream may have diverged."
  echo "   You may need to rebase or cherry-pick manually."
  echo "   cd ./navidrome && git log --oneline HEAD..origin/main"
  exit 1
}

AFTER_VERSION=$(cd "$NAVIDROME_DIR" && git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
AFTER_HASH=$(cd "$NAVIDROME_DIR" && git rev-parse --short HEAD)
echo "After:  $AFTER_VERSION ($AFTER_HASH)"

if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
  echo ""
  echo "✅ Already up to date. No changes."
  exit 0
fi

echo ""
echo "📋 Changes since $BEFORE_VERSION:"
(cd "$NAVIDROME_DIR" && git log --oneline "${BEFORE_HASH}..HEAD" | head -20)

# ─── Re-apply patches ─────────────────────────────────────────────────────────

PATCH_COUNT=$(find ./patches -name "*.patch" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PATCH_COUNT" -gt 0 ]; then
  echo ""
  echo "🩹 Re-applying $PATCH_COUNT patch(es)..."
  for patch in ./patches/*.patch; do
    echo "   Applying: $(basename "$patch")"
    if (cd "$NAVIDROME_DIR" && git apply "../$patch" 2>/dev/null); then
      echo "   ✅ Applied"
    else
      echo "   ❌ Patch failed — conflicts with upstream changes."
      echo "      Review: patches/$(basename "$patch")"
      echo "      Update the patch and run this script again."
      PATCH_FAILED=1
    fi
  done
fi

echo ""
if [ -n "$PATCH_FAILED" ]; then
  echo "⚠️  Some patches failed. Review and update them before proceeding."
  echo "   See patches/README.md for patch management workflow."
else
  echo "✅ Upstream update complete!"
  echo ""
  echo "Next steps:"
  echo "  1. Review the changelog above for breaking changes"
  echo "  2. Test locally: pnpm dev"
  echo "  3. Update FORK_NOTES.md with any relevant upstream changes"
  echo "  4. Update the base version in FORK_NOTES.md"
fi
echo ""
