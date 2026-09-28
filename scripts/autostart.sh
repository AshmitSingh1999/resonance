#!/bin/bash
#
# Install or remove a launchd agent that keeps the Resonance daemon running.
#
# A user LaunchAgent is the right mechanism here: it starts at login without
# needing root, restarts the daemon if it exits, and is removed cleanly with one
# command. The plist is generated rather than committed because it must carry
# absolute paths to this checkout and to the Node binary in use.
#
# Usage:  scripts/autostart.sh install | uninstall | status

set -euo pipefail

LABEL="com.resonance.daemon"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "usage: $0 {install|uninstall|status}" >&2
  exit 64
}

install_agent() {
  local node_bin npx_bin
  node_bin="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
  npx_bin="$REPO/node_modules/.bin/tsx"

  if [[ ! -x "$npx_bin" ]]; then
    echo "tsx not found — run 'npm install' first" >&2
    exit 1
  fi
  if [[ ! -d "$REPO/vendor/mediaremote-adapter/build/MediaRemoteAdapter.framework" ]]; then
    echo "MediaRemote adapter is not built — see the README setup section" >&2
    exit 1
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.resonance"

  cat > "$PLIST" <<PLIST_BODY
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$npx_bin</string>
    <string>$REPO/packages/daemon/src/index.ts</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$REPO</string>

  <key>RunAtLoad</key>
  <true/>

  <!-- Restart if it exits, but back off so a persistent failure does not spin. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>$REPO/.resonance/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO/.resonance/daemon.error.log</string>

  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
PLIST_BODY

  # Unload any previous version first, or the old one keeps running.
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"

  echo "installed $LABEL"
  echo "  plist : $PLIST"
  echo "  logs  : $REPO/.resonance/daemon.log"
  echo "  open  : http://localhost:4747"
}

uninstall_agent() {
  if [[ -f "$PLIST" ]]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
  else
    echo "$LABEL is not installed"
  fi
}

status_agent() {
  if launchctl list | grep -q "$LABEL"; then
    echo "running:"
    launchctl list | grep "$LABEL"
  else
    echo "$LABEL is not loaded"
  fi
  if curl -fsS -o /dev/null http://localhost:4747/ 2>/dev/null; then
    echo "daemon is responding on http://localhost:4747"
  else
    echo "daemon is not responding on port 4747"
  fi
}

case "${1:-}" in
  install)   install_agent ;;
  uninstall) uninstall_agent ;;
  status)    status_agent ;;
  *)         usage ;;
esac
