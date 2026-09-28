#!/bin/bash
#
# Create a stable self-signed code-signing identity for the audio helper.
#
# Why this exists: macOS keys its TCC permission records to a binary's signing
# identity. An ad-hoc signature is a plain hash of the binary, so every rebuild
# produces a *different* identity and macOS asks for system-audio permission
# again — which would defeat the entire point of the native helper.
#
# A self-signed certificate gives a stable, certificate-based designated
# requirement, so the grant survives rebuilds.
#
# Run once. Safe to re-run: it detects an existing identity and stops.

set -euo pipefail

NAME="Resonance Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -p codesigning | grep -q "$NAME"; then
  echo "identity '$NAME' already exists — nothing to do"
  security find-identity -p codesigning | grep "$NAME"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# extendedKeyUsage=codeSigning is what makes `security find-identity -p
# codesigning` list it; without it the cert exists but codesign will not use it.
cat > "$WORK/openssl.cnf" <<'CONF'
[ req ]
distinguished_name = dn
x509_extensions    = ext
prompt             = no

[ dn ]
CN = Resonance Dev

[ ext ]
basicConstraints       = critical,CA:false
keyUsage               = critical,digitalSignature
extendedKeyUsage       = critical,codeSigning
CONF

echo "generating certificate..."
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -config "$WORK/openssl.cnf" 2>/dev/null

# OpenSSL 3 defaults to a PKCS#12 MAC and KDF that macOS's Security framework
# cannot verify — the import fails with "MAC verification failed". The legacy
# SHA1/3DES algorithms are what `security import` understands. A non-empty
# password is used for the same reason: the empty-password path is unreliable.
openssl pkcs12 -export -out "$WORK/bundle.p12" \
  -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -macalg sha1 -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES \
  -passout pass:resonance 2>/dev/null

echo "importing into the login keychain (macOS may ask for your password)..."
security import "$WORK/bundle.p12" -k "$KEYCHAIN" -P resonance \
  -T /usr/bin/codesign -T /usr/bin/security

# Without this, codesign prompts for keychain access on every single build.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || \
  echo "note: could not set partition list; codesign may prompt for keychain access"

echo
if security find-identity -p codesigning | grep -q "$NAME"; then
  echo "created '$NAME':"
  security find-identity -p codesigning | grep "$NAME"
  echo
  # A self-signed certificate is always reported untrusted, which matters for
  # Gatekeeper but not here: what TCC keys on is the certificate identity, and
  # that is stable. Signing works regardless.
  echo "The 'not trusted' note above is expected and harmless — it only affects"
  echo "Gatekeeper verification, not the stability of the signing identity."
else
  echo "certificate import did not produce a codesigning identity" >&2
  exit 1
fi
