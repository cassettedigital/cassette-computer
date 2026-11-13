#!/usr/bin/env bash
# One-time: create a stable self-signed code-signing identity so macOS TCC grants
# (disc drive, local network) PERSIST across rebuilds of Cassette Player.app.
#
# WHY: build-app.sh ad-hoc signs by default, which changes the app's code hash on
# every build — so macOS treats each rebuild as a brand-new app and re-prompts for
# permissions. Signing with ONE stable identity gives the app a constant code
# identity, and TCC remembers the grants.
#
# This modifies YOUR login keychain (adds one self-signed cert + key), which is
# why it's a script you run yourself rather than something the build does. Safe to
# re-run (it no-ops if the identity already exists). To undo: delete "Cassette Code
# Signing" from Keychain Access.
set -euo pipefail

NAME="Cassette Code Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then
  echo "✓ '$NAME' already exists — nothing to do."
  exit 0
fi

echo "Creating self-signed code-signing certificate '$NAME'…"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/req.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = $NAME
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -days 3650 -nodes -config "$TMP/req.cnf" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/id.p12" -passout pass: -name "$NAME" >/dev/null 2>&1

# Import into the login keychain, pre-authorize codesign to use the private key.
security import "$TMP/id.p12" -k "$KEYCHAIN" -P "" -T /usr/bin/codesign -A

echo
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then
  echo "✓ Installed. build-app.sh will now sign with '$NAME' automatically."
  echo
  echo "Next: rebuild once — ./native/build-app.sh"
  echo "  • On this first rebuild macOS may show ONE 'codesign wants to use key'"
  echo "    prompt — click ALWAYS ALLOW."
  echo "  • It may also re-ask the disc-drive / local-network permission ONE last"
  echo "    time (the identity changed from ad-hoc). Grant it, and every rebuild"
  echo "    after that stays silent."
else
  echo "✗ Something went wrong — '$NAME' is not a valid codesigning identity."
  echo "  Fallback: Keychain Access → Certificate Assistant → Create a Certificate,"
  echo "  name '$NAME', Identity Type: Self Signed Root, Certificate Type: Code Signing."
  exit 1
fi
