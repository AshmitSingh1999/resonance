#!/bin/bash
#
# Set up local control of a Tuya smart bulb (Wipro Next and similar white-labels).
#
# Tuya bulbs can be driven entirely over the LAN — no cloud at runtime — but doing
# so needs a per-device "local key" that is only obtainable through a Tuya IoT
# Cloud developer account. That is a one-time cost; the key is then stored here.
#
# tinytuya goes in a virtualenv so it never touches the system Python.
#
# Usage:  scripts/tuya-setup.sh [wizard|scan|test]

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO/.resonance/tuya-venv"
CONFIG="$REPO/.resonance/light.json"
PY="$VENV/bin/python"
ENV_FILE="$REPO/.resonance/tuya.env"

# Credentials live in a gitignored env file so they are entered once, never
# pasted into a shell history, and never committed.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ensure_venv() {
  if [[ ! -x "$PY" ]]; then
    echo "creating virtualenv at ${VENV}..."
    mkdir -p "$REPO/.resonance"
    python3 -m venv "$VENV"
  fi
  if ! "$PY" -c 'import tinytuya' 2>/dev/null; then
    echo "installing tinytuya..."
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet tinytuya
  fi
  echo "tinytuya $("$PY" -c 'import tinytuya; print(tinytuya.__version__)')"
}

guide() {
  cat <<'GUIDE'

────────────────────────────────────────────────────────────────────────
Before running the wizard you need a Tuya IoT Cloud project.

 1. Pair the bulb in the Wipro Next Smart Home (or Smart Life) app first.
 2. Sign up at https://iot.tuya.com  →  Cloud  →  Create Cloud Project
       Data centre: pick the one matching your region (India / Central Europe)
 3. In the project:  Devices  →  Link App Account  →  scan the QR code
       from the mobile app (Me → top-right icon)
 4. Note the project's Access ID and Access Secret — the wizard asks for them.

 IMPORTANT: the IoT Core trial expires (error 28841002 "subscription has
 expired"). If the wizard fails with a permissions error:
       Cloud → Project management → Upgrade IoT Core Plan
       → Trial edition ($0.00) → Extend trial period → fill the short form
 Approval usually lands within a few minutes.
────────────────────────────────────────────────────────────────────────

GUIDE
}

case "${1:-wizard}" in
  wizard|keys)
    ensure_venv
    if [[ -z "${TUYA_API_KEY:-}" || -z "${TUYA_API_SECRET:-}" ]]; then
      guide
      cat <<'NEEDED'
Then re-run with the project's credentials:

  TUYA_API_KEY=xxxx TUYA_API_SECRET=yyyy TUYA_REGION=in \
    ./scripts/tuya-setup.sh keys

TUYA_REGION is one of: in (India), us, eu, cn.

NEEDED
      exit 1
    fi

    cd "$REPO/.resonance"
    # Calling the Cloud API directly rather than `tinytuya wizard`: the wizard
    # prompts for everything interactively, which cannot work when stdin is not
    # a terminal. This fetches exactly the same data without any prompting.
    TUYA_REGION="${TUYA_REGION:-in}" "$PY" - <<'FETCH'
import json, os, pathlib, sys
import tinytuya

snapshot = pathlib.Path("snapshot.json")
if not snapshot.exists():
    raise SystemExit("  no snapshot.json - run 'scripts/tuya-setup.sh scan' first")

found = json.loads(snapshot.read_text()).get("devices", [])
if not found:
    raise SystemExit("  the LAN scan found no devices - is the bulb powered on?")

# The API resolves the account from one device id. That device must actually be
# in the project: re-pairing a bulb issues it a NEW id, which leaves a stale LAN
# snapshot pointing at ids the project has never seen and fails with code 1106.
# TUYA_ANCHOR_DEVICE_ID lets the id be taken straight from the portal's Devices tab.
anchor = os.environ.get("TUYA_ANCHOR_DEVICE_ID") or found[0]["id"]

cloud = tinytuya.Cloud(
    apiRegion=os.environ["TUYA_REGION"],
    apiKey=os.environ["TUYA_API_KEY"],
    apiSecret=os.environ["TUYA_API_SECRET"],
    apiDeviceID=anchor,
)

devices = cloud.getdevices()
if isinstance(devices, dict) and devices.get("Error"):
    message = str(devices.get("Payload") or devices.get("Error"))
    if "28841002" in message or "expired" in message.lower():
        raise SystemExit(
            "  the IoT Core trial has expired.\n"
            "  iot.tuya.com -> Cloud -> Project management -> Upgrade IoT Core Plan\n"
            "  -> Trial edition -> Extend trial period, then retry in a few minutes."
        )
    raise SystemExit(f"  Tuya API error: {message[:300]}")

pathlib.Path("devices.json").write_text(json.dumps(devices, indent=2) + "\n")
print(f"  fetched {len(devices)} device(s) from the cloud account:")
for d in devices:
    print(f"    {(d.get('name') or '(unnamed)'):<24} key={'yes' if d.get('key') else 'MISSING'}  id={d.get('id')}")
print("\n  next: scripts/tuya-setup.sh configure")
FETCH
    ;;

  scan)
    ensure_venv
    cd "$REPO/.resonance"
    echo "scanning the LAN for Tuya devices (this takes ~20s)..."
    # The scanner draws a progress spinner on stdout, hundreds of frames of it.
    # Keep the snapshot it writes and report from that instead.
    "$PY" -m tinytuya scan >/dev/null 2>&1 || true
    "$PY" - <<'REPORT'
import json, pathlib
snapshot = pathlib.Path("snapshot.json")
if not snapshot.exists():
    raise SystemExit("  no devices found on the network")
devices = json.loads(snapshot.read_text()).get("devices", [])
if not devices:
    raise SystemExit("  no devices found on the network")
print(f"  found {len(devices)} device(s):")
for d in devices:
    name = d.get("name") or "(unnamed)"
    print(f"    {name:<24} {d.get('ip'):<16} v{d.get('ver')}  id={d.get('id')}")
REPORT
    echo
    echo "next: scripts/tuya-setup.sh configure"
    ;;

  configure)
    ensure_venv
    cd "$REPO/.resonance"
    # Merge what the two steps each know: the wizard has the local keys, the scan
    # has the addresses and protocol versions. Doing it here avoids asking anyone
    # to hand-edit JSON.
    "$PY" - "$CONFIG" <<'MERGE'
import json, pathlib, sys

config_path = pathlib.Path(sys.argv[1])
devices_file = pathlib.Path("devices.json")
snapshot_file = pathlib.Path("snapshot.json")

if not devices_file.exists():
    raise SystemExit("  no devices.json - run 'scripts/tuya-setup.sh wizard' first")
if not snapshot_file.exists():
    raise SystemExit("  no snapshot.json - run 'scripts/tuya-setup.sh scan' first")

cloud = json.loads(devices_file.read_text())
local = {d.get("id"): d for d in json.loads(snapshot_file.read_text()).get("devices", [])}

candidates = []
for device in cloud:
    found = local.get(device.get("id"))
    if found and device.get("key"):
        candidates.append({
            "name": device.get("name") or "(unnamed)",
            "id": device["id"],
            "key": device["key"],
            "ip": found.get("ip"),
            "version": str(found.get("ver") or "3.3"),
        })

if not candidates:
    raise SystemExit(
        "  no device appears in both the cloud account and the LAN scan.\n"
        "  Check the bulb is powered on and on the same network."
    )

print("  devices that can be controlled locally:")
for i, c in enumerate(candidates, 1):
    print(f"    {i}) {c['name']:<24} {c['ip']:<16} v{c['version']}")

choice = 1
if len(candidates) > 1:
    raw = input("  which one is the bulb? [1] ").strip()
    if raw:
        choice = int(raw)
chosen = candidates[choice - 1]

existing = {}
if config_path.exists():
    try:
        existing = json.loads(config_path.read_text())
    except json.JSONDecodeError:
        existing = {}

existing.setdefault("enabled", True)
existing.setdefault("mode", "palette")
existing.setdefault("updateHz", 8)
existing.setdefault("maxBrightness", 0.9)
existing["device"] = {k: chosen[k] for k in ("id", "key", "ip", "version")}

config_path.write_text(json.dumps(existing, indent=2) + "\n")
print(f"\n  wrote {config_path}")
print(f"  bulb: {chosen['name']} at {chosen['ip']} (protocol v{chosen['version']})")
print("\n  next: scripts/tuya-setup.sh test")
MERGE
    ;;

  test)
    ensure_venv
    if [[ ! -f "$CONFIG" ]]; then
      echo "no $CONFIG yet — run the wizard and scan first" >&2
      exit 1
    fi
    "$PY" "$REPO/bridges/tuya-bulb/bridge.py" --self-test --config "$CONFIG"
    ;;

  *)
    echo "usage: $0 {wizard|scan|configure|test}" >&2
    exit 64
    ;;
esac
