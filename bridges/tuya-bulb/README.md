# tuya-bulb bridge

A Python process that drives a Tuya-platform smart bulb over the LAN. Spawned by
the daemon.

## Why Python

`tuyapi` (Node) is no longer actively developed; `tinytuya` is, and covers the
3.4/3.5 protocol versions current bulb firmware uses. Since the project already
spawns helper processes that speak NDJSON — the perl MediaRemote adapter and the
Swift audio tap — a third one costs little and buys the maintained library.

## Protocol

Unlike the other two helpers this is **bidirectional**: commands arrive as JSON
lines on stdin, status goes out on stdout.

```
in   {"cmd":"colour","h":210,"s":900,"v":640,"payload":"1..."}
in   {"cmd":"power","on":true}
out  {"type":"ready","ip":"192.168.1.42","version":"3.5"}
out  {"type":"wrote"}
out  {"type":"error","code":"unreachable","message":"..."}
```

## Decisions worth not undoing

**Colour goes to data point 27 (`music_data`), not the ordinary colour DP.** DP 27
applies instantly; the colour DP runs the bulb's slow fade, which turns anything
beat-driven into mush.

**The socket is persistent.** This matters more than anything else here. Without
`set_socketPersistent(True)` every command opens a fresh TCP connection, which
costs far more than the update itself and makes rapid changes impossible.

**Writes are fire-and-forget (`nowait=True`), and the bridge acks them itself.**
The device never acknowledges DP 27, so there is no ack-based flow control to
lean on. Without the bridge's own `{"type":"wrote"}`, the only backpressure
signal is the OS pipe buffer — some 800 commands deep — which is latency the
listener sees as the light lagging behind the music.

**Reconnection backs off exponentially.** A bulb switched off at the wall should
not be hammered.

## Looks broken but isn't

**An acknowledged write appears to take ~4 seconds.** That is the socket timeout,
not device latency — DP 27 is never acknowledged, so there is nothing to wait for.
Do not use acknowledged writes to measure round-trip time.

**`status()` is unreliable immediately after a burst.** This is a poor health
check; a failure right after rapid writes does not reliably mean the bulb is
saturated.

## Setup

See `scripts/tuya-setup.sh`. The bridge needs `.resonance/light.json` with the
device id, local key, IP and protocol version.

Re-pairing a bulb issues it a **new device id and a new local key** — the most
confusing failure mode here, since the portal and the LAN then disagree and the
cloud lookup fails with a permissions error that suggests something else entirely.
