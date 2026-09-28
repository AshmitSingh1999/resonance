#!/usr/bin/env python3
"""
Drive a Tuya smart bulb from the Resonance daemon.

Spawned as a child process speaking NDJSON, the same arrangement as the
MediaRemote perl adapter and the Swift audio helper. Unlike those two this one is
bidirectional: commands arrive as JSON lines on stdin, status goes out on stdout.

  in   {"cmd":"colour","h":210,"s":900,"v":640}
  in   {"cmd":"power","on":true}
  out  {"type":"ready","ip":"192.168.1.42","version":"3.4"}
  out  {"type":"error","code":"unreachable","message":"..."}

Colour is written to data point 27 (music_data), which applies instantly. The
ordinary colour data point runs the bulb's slow fade, which turns anything
beat-driven into mush.
"""

import json
import signal
import sys
import time

try:
    import tinytuya
except ImportError:
    print(json.dumps({
        "type": "error", "code": "no-tinytuya",
        "message": "tinytuya is not installed — run scripts/tuya-setup.sh",
    }), flush=True)
    sys.exit(1)


# Tuya lighting data points.
DP_SWITCH = "20"
DP_WORK_MODE = "21"
DP_MUSIC = "27"

# Reconnect backoff: a bulb that is off at the wall should not be hammered.
BACKOFF_START = 1.0
BACKOFF_MAX = 30.0


def emit(**payload):
    """One JSON object per line on stdout; nothing else is written there."""
    print(json.dumps(payload), flush=True)


def log(message):
    print(message, file=sys.stderr, flush=True)


class Bulb:
    def __init__(self, device):
        self.device = device
        self.handle = None
        self.backoff = BACKOFF_START
        self.next_attempt = 0.0

    def connect(self):
        """Open a persistent connection. Returns True on success."""
        now = time.monotonic()
        if now < self.next_attempt:
            return False

        try:
            handle = tinytuya.BulbDevice(
                dev_id=self.device["id"],
                address=self.device["ip"],
                local_key=self.device["key"],
                version=float(self.device.get("version", 3.3)),
            )
            # Persistent socket matters more than anything else here: without it
            # every command opens a fresh TCP connection, which costs far more
            # than the update itself and makes rapid changes impossible.
            handle.set_socketPersistent(True)
            handle.set_socketTimeout(3)

            status = handle.status()
            if not isinstance(status, dict) or "dps" not in status:
                raise RuntimeError(status.get("Error", status) if isinstance(status, dict) else status)

            self.handle = handle
            self.backoff = BACKOFF_START
            emit(type="ready", ip=self.device["ip"], version=str(self.device.get("version")))
            return True

        except Exception as error:  # noqa: BLE001 — any failure means "try later"
            self.handle = None
            self.next_attempt = now + self.backoff
            self.backoff = min(BACKOFF_MAX, self.backoff * 2)
            emit(type="error", code="unreachable", message=str(error)[:200])
            return False

    def ensure_music_mode(self):
        """Put the bulb in music mode so data point 27 is honoured."""
        if self.handle is None:
            return
        try:
            self.handle.set_value(DP_WORK_MODE, "music", nowait=True)
        except Exception as error:  # noqa: BLE001
            emit(type="error", code="mode-failed", message=str(error)[:200])

    def set_colour(self, h, s, v, payload):
        if self.handle is None and not self.connect():
            return
        try:
            # nowait: fire and forget. The daemon's throttle governs the rate, and
            # waiting for an acknowledgement here would serialise updates behind
            # the round-trip time and defeat the point.
            self.handle.set_value(DP_MUSIC, payload, nowait=True)
            # Acknowledge so the daemon can bound how many writes are in flight.
            # The device never acks DP 27 itself, so without this the only
            # backpressure signal is the OS pipe buffer - some 800 commands deep,
            # which is latency the listener would see as the light lagging.
            emit(type="wrote")
        except Exception as error:  # noqa: BLE001
            self.handle = None
            self.next_attempt = time.monotonic() + self.backoff
            emit(type="error", code="write-failed", message=str(error)[:200])

    def set_power(self, on):
        if self.handle is None and not self.connect():
            return
        try:
            self.handle.set_value(DP_SWITCH, bool(on))
            if on:
                self.ensure_music_mode()
        except Exception as error:  # noqa: BLE001
            emit(type="error", code="write-failed", message=str(error)[:200])


def load_config(path):
    with open(path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    device = config.get("device") or {}
    for field in ("id", "key", "ip"):
        if not device.get(field):
            raise SystemExit(json.dumps({
                "type": "error", "code": "unconfigured",
                "message": f"light.json is missing device.{field}",
            }))
    return device


def self_test(bulb):
    """Walk a few colours so a human can confirm the bulb obeys."""
    if not bulb.connect():
        log("could not reach the bulb")
        return 1
    bulb.set_power(True)
    bulb.ensure_music_mode()
    for name, payload in [
        ("red", "0000003e803e800000000"),
        ("green", "0007803e803e800000000"),
        ("blue", "000f003e803e800000000"),
    ]:
        log(f"  {name}")
        bulb.set_colour(0, 0, 0, payload)
        time.sleep(1.2)
    log("self-test finished")
    return 0


def main():
    args = sys.argv[1:]
    if "--config" not in args:
        raise SystemExit("usage: bridge.py --config <path/to/light.json> [--self-test]")
    config_path = args[args.index("--config") + 1]

    bulb = Bulb(load_config(config_path))

    if "--self-test" in args:
        sys.exit(self_test(bulb))

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

    bulb.connect()
    bulb.ensure_music_mode()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            emit(type="error", code="bad-command", message=line[:120])
            continue

        kind = command.get("cmd")
        if kind == "colour":
            bulb.set_colour(command.get("h", 0), command.get("s", 0), command.get("v", 0),
                            command.get("payload", ""))
        elif kind == "power":
            bulb.set_power(command.get("on", True))
        elif kind == "ping":
            emit(type="pong", connected=bulb.handle is not None)
        else:
            emit(type="error", code="unknown-command", message=str(kind)[:60])


if __name__ == "__main__":
    main()
