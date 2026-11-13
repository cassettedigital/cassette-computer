# Cassette Player — Wrapper Dockerfile
# GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
#
# NOTE: This file is now a placeholder / reference. The actual build lives
# in ./navidrome/Dockerfile (Navidrome's own multi-stage Dockerfile).
# docker-compose.yml points at that Dockerfile directly.
#
# For local dev:
#   docker compose build && docker compose up -d
#
# The Cassette theme is baked in at compile time via
#   ui/src/themes/CassetteTheme.js + CassetteTheme.css.js
# and activated via ND_DEFAULTTHEME=Cassette in docker-compose.yml.
#
# Previous approach (mounting cassette-theme.css into the container) was
# incorrect — Navidrome embeds the entire React UI into the Go binary.
# File mounts cannot override embedded assets at runtime.

# This file is intentionally minimal. See ./navidrome/Dockerfile for the
# actual multi-stage build.
FROM scratch
LABEL org.opencontainers.image.title="Cassette Player"
LABEL org.opencontainers.image.description="GPL v3 fork of Navidrome with Cassette design system"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.source="https://github.com/navidrome/navidrome"
