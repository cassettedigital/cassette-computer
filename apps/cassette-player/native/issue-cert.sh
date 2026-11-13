#!/usr/bin/env bash
# issue-cert.sh — obtain the publicly-trusted TLS cert for the local HTTPS
# portal (CD-Rip, Job 1). Run once to provision, re-run to renew.
#
# ── HUMAN STEP ───────────────────────────────────────────────────────────────
# This needs a Cloudflare API token (cassette.digital is on Cloudflare DNS:
# zelda/jay.ns.cloudflare.com) with **Zone › DNS › Edit** on the cassette.digital
# zone. DNS-01 is the only option: the names resolve to 127.0.0.1 (loopback), so
# HTTP-01 / TLS-ALPN can never reach them. Export the token, then run this once:
#
#   export CLOUDFLARE_DNS_API_TOKEN=...      # scoped DNS:Edit token
#   ./native/issue-cert.sh
#
# Prereq (one-time): the DNS records must exist (also a human step) —
#   local.cassette.digital      A  127.0.0.1
#   *.local.cassette.digital    A  127.0.0.1   (for future per-device naming)
#
# ── What it does ─────────────────────────────────────────────────────────────
# Issues ONE Let's Encrypt cert whose SAN covers BOTH the apex
# local.cassette.digital AND the wildcard *.local.cassette.digital. The apex is
# listed first deliberately: a *.local.cassette.digital wildcard does NOT match
# the bare local.cassette.digital, and the dashboard fetches the bare host — so
# both must be on the cert. Writes cert.pem + key.pem into the sidecar cert dir;
# restart Cassette Player (or the sidecar) and it serves HTTPS.
#
# ── Swap boundary ────────────────────────────────────────────────────────────
# This is the shared-wildcard-cert foundation. The sidecar only consumes the two
# files (cert.go / sharedFileCert), so replacing this with per-device ACME later
# means a new issuance path writing the same two files — nothing else changes.
set -euo pipefail

DOMAIN="${CASSETTE_LOCAL_DOMAIN:-local.cassette.digital}"
EMAIL="${CASSETTE_ACME_EMAIL:-admin@cassette.digital}"
CERT_DIR="${SIDECAR_CERT_DIR:-$HOME/Library/Application Support/Cassette Player/certs}"
LEGO_DIR="${LEGO_DATA_DIR:-$HOME/Library/Application Support/Cassette Player/lego}"

# lego's Cloudflare provider reads CLOUDFLARE_DNS_API_TOKEN (scoped token).
: "${CLOUDFLARE_DNS_API_TOKEN:?Set CLOUDFLARE_DNS_API_TOKEN — a Cloudflare API token with Zone:DNS:Edit on cassette.digital}"

if ! command -v lego >/dev/null 2>&1; then
  echo "FATAL: lego not found." >&2
  echo "  Install:  brew install lego" >&2
  echo "       or:  go install github.com/go-acme/lego/v4/cmd/lego@latest" >&2
  exit 1
fi

mkdir -p "$CERT_DIR" "$LEGO_DIR"

echo "[issue-cert] requesting cert for ${DOMAIN} + *.${DOMAIN} via Cloudflare DNS-01…"
# lego v5 takes these as flags ON the `run` subcommand (v4 accepted them as
# global flags BEFORE `run` — that older ordering fails on v5 with
# "flag provided but not defined: -accept-tos"). Keep them after `run`.
# Before asking Let's Encrypt to validate, lego confirms the TXT challenge has
# propagated. By default it checks the SYSTEM's recursive resolver — here an ISP
# resolver (216.17.25.x) that doesn't reflect the freshly-created record in time,
# giving "recursive nameservers did not return the expected TXT record". So:
#   --dns.resolvers          → check via Cloudflare's public resolver (same
#                              provider hosting the zone; reflects API writes in
#                              seconds). Override with LEGO_RESOLVER if needed.
#   --dns.propagation.disable-rns → skip the recursive-resolver pre-check; LE
#                              still validates against the authoritative NS.
LEGO_RESOLVER="${LEGO_RESOLVER:-1.1.1.1:53}"
lego run \
  --accept-tos \
  --email "$EMAIL" \
  --dns cloudflare \
  --dns.resolvers "$LEGO_RESOLVER" \
  --dns.propagation.disable-rns \
  --domains "$DOMAIN" \
  --domains "*.$DOMAIN" \
  --path "$LEGO_DIR"

# lego writes into $LEGO_DIR/certificates/, naming files after the FIRST
# --domains value (the apex here): local.cassette.digital.crt / .key. Fall back
# to the only non-issuer .crt if a future lego sanitizes the name differently.
CERTS_OUT="$LEGO_DIR/certificates"
SRC_CRT="$CERTS_OUT/${DOMAIN}.crt"
SRC_KEY="$CERTS_OUT/${DOMAIN}.key"
if [ ! -f "$SRC_CRT" ] || [ ! -f "$SRC_KEY" ]; then
  SRC_CRT="$(ls "$CERTS_OUT"/*.crt 2>/dev/null | grep -v '\.issuer\.crt$' | head -1)"
  SRC_KEY="$(ls "$CERTS_OUT"/*.key 2>/dev/null | head -1)"
fi
[ -n "${SRC_CRT:-}" ] && [ -f "$SRC_CRT" ] && [ -n "${SRC_KEY:-}" ] && [ -f "$SRC_KEY" ] || {
  echo "FATAL: could not find lego output in $CERTS_OUT" >&2
  echo "       (check the lego run output above)" >&2
  exit 1
}

install -m 644 "$SRC_CRT" "$CERT_DIR/cert.pem"
install -m 600 "$SRC_KEY" "$CERT_DIR/key.pem"

echo "[issue-cert] wrote:"
echo "    $CERT_DIR/cert.pem"
echo "    $CERT_DIR/key.pem"
echo "[issue-cert] done. Restart Cassette Player (or the sidecar) to serve HTTPS"
echo "             at https://${DOMAIN}:5173"
