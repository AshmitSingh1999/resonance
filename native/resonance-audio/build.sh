#!/bin/bash
#
# Build and sign the audio helper.
#
# The Info.plist is embedded into the binary rather than sitting beside it: this
# is a plain executable, not an app bundle, and macOS only reads
# NSAudioCaptureUsageDescription from the __TEXT,__info_plist section.
#
# Signing uses a stable self-signed identity so the TCC grant survives rebuilds.
# With an ad-hoc signature the identity is a hash of the binary and macOS asks
# for permission again after every build.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/build"
BINARY="$OUT/resonance-audio"
IDENTITY="Resonance Dev"

mkdir -p "$OUT"

echo "compiling..."
swiftc -O \
  -o "$BINARY" \
  -framework AudioToolbox -framework CoreAudio -framework Accelerate \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$HERE/Info.plist" \
  "$HERE/Sources/main.swift"

# Deliberately not `-v`: a self-signed certificate is reported untrusted and so
# is never listed among "valid" identities, yet codesign uses it perfectly well
# and — crucially — produces a certificate-based designated requirement that is
# stable across rebuilds. Measured: cert signing gives
#   identifier "dev.resonance.audio" and certificate leaf = H"..."
# whereas ad-hoc gives `cdhash H"..."`, which changes on every build and makes
# macOS re-ask for system-audio permission each time.
# codesign blocks indefinitely when the signing key's access control does not
# include it: macOS puts up a keychain dialog and waits forever in a
# non-interactive shell. Bound the wait so this reports the cause instead of
# looking like a compiler that has hung.
sign_with_timeout() {
  local seconds=25
  codesign --force --sign "$IDENTITY" --identifier dev.resonance.audio --timestamp=none "$BINARY" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$seconds" ]; then
      kill -9 "$pid" 2>/dev/null
      cat >&2 <<'GUIDANCE'

codesign is blocked on a keychain permission dialog.

Either click "Always Allow" on the dialog macOS is showing, or grant access once
from a terminal (it will ask for your login password):

  security set-key-partition-list -S apple-tool:,apple:,codesign: \
    -s -k "$(read -s -p 'login password: ' p; echo "$p")" \
    ~/Library/Keychains/login.keychain-db

Until then the helper cannot be signed with a stable identity, and macOS will
ask for system-audio permission again after every rebuild.
GUIDANCE
      return 1
    fi
  done
  wait "$pid"
}

if security find-identity -p codesigning | grep -q "$IDENTITY"; then
  echo "signing with '$IDENTITY'..."
  sign_with_timeout || exit 1
else
  echo
  echo "WARNING: no '$IDENTITY' identity found — signing ad-hoc." >&2
  echo "macOS will ask for system-audio permission again after every rebuild." >&2
  echo "Run scripts/signing-cert.sh once to fix this." >&2
  echo
  codesign --force --sign - --identifier dev.resonance.audio "$BINARY"
fi

echo
codesign -dv "$BINARY" 2>&1 | grep -E 'Identifier|Authority|Signature' || true
echo
echo "built: $BINARY"
