#!/bin/bash
# Cassette Player — Build Script
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# Builds the production Docker image with Cassette theme baked in.
# Run from: apps/cassette-player/
# Usage: pnpm build   OR   bash scripts/build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

VERSION="${1:-latest}"
IMAGE_NAME="cassette-player"
REGISTRY="${REGISTRY:-}"   # Set REGISTRY env var to push to a registry (e.g. registry.fly.io/cassette-player)

echo ""
echo "🎵 Cassette Player — Build"
echo "=========================="
echo "  Image:   $IMAGE_NAME:$VERSION"
if [ -n "$REGISTRY" ]; then
  echo "  Registry: $REGISTRY"
fi
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker is required."
  exit 1
fi

# ─── Build ────────────────────────────────────────────────────────────────────

echo "🏗️  Building Docker image..."
docker build \
  --tag "$IMAGE_NAME:$VERSION" \
  --tag "$IMAGE_NAME:latest" \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  .

echo ""
echo "✅ Build complete: $IMAGE_NAME:$VERSION"

# ─── Push (optional) ──────────────────────────────────────────────────────────

if [ -n "$REGISTRY" ]; then
  echo ""
  echo "📤 Pushing to registry: $REGISTRY"
  docker tag "$IMAGE_NAME:$VERSION" "$REGISTRY:$VERSION"
  docker tag "$IMAGE_NAME:latest" "$REGISTRY:latest"
  docker push "$REGISTRY:$VERSION"
  docker push "$REGISTRY:latest"
  echo "✅ Pushed: $REGISTRY:$VERSION"
fi

echo ""
echo "Run it locally:"
echo "  docker run -d \\"
echo "    -p 4533:4533 \\"
echo "    -v \$(pwd)/music:/music:ro \\"
echo "    -v \$(pwd)/data:/data \\"
echo "    $IMAGE_NAME:$VERSION"
echo ""
