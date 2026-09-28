# Resonance

A lyric display for macOS, in the spirit of the Cotodama Lyric Speaker.

Whatever is playing — Spotify, Apple Music, or a browser tab — Resonance finds the
words, shows them in time, and renders them as kinetic typography that reacts to
the music. Colour is sampled from the album artwork. Optionally, a smart bulb
takes its colour from the same source, so the room matches the screen.

Everything runs locally. No account, no telemetry, nothing leaves the machine
except lyric lookups.

---

## What it does

- **Finds the song** playing anywhere on the Mac, with position accurate enough
  to sync words to it.
- **Fetches time-synced lyrics** and highlights each line as it is sung, with a
  word-level sweep across the line.
- **Reacts to the audio** — real system audio, captured natively, with no
  screen-share prompt after the first time.
- **Themes itself per track** — a palette sampled from the album artwork, and a
  typeface family chosen from the song's lyric density and energy.
- **Drives a smart bulb** (optional) from the same audio features.

---

## Requirements

| | |
|---|---|
| macOS | 14.2 or later — Core Audio process taps are used for audio capture |
| Node | 22 or later — uses the built-in `node:sqlite` |
| Xcode Command Line Tools | to build the two native components |
| Homebrew | for `cmake` |
| A Tuya-platform smart bulb | optional; Wipro Next, Smart Life and most white-labels |

Developed against macOS 26. The MediaRemote path below is the part most likely to
be affected by an OS update.

---

## Setup

### 1. Dependencies

```sh
npm install
```

### 2. The MediaRemote adapter

Reads what is currently playing. Built once:

```sh
brew install cmake
cd vendor/mediaremote-adapter && mkdir -p build && cd build
cmake .. && cmake --build .
```

### 3. The audio helper

Captures system audio. Two steps, and the first is not optional ceremony:

```sh
./scripts/signing-cert.sh          # once: creates a stable signing identity
./native/resonance-audio/build.sh  # compiles and signs the helper
```

macOS keys its permission records to a binary's **signing identity**. An ad-hoc
signature is a hash of the binary, so every rebuild looks like a new application
and macOS asks for permission again. A self-signed certificate gives a stable
identity, and the grant survives rebuilds:

| Signing | Designated requirement | Survives a rebuild |
|---|---|---|
| self-signed certificate | `identifier + certificate leaf` | yes |
| ad-hoc | `cdhash H"…"` | no |

The certificate is reported *untrusted*. That is expected and harmless — it
affects Gatekeeper verification, not the stability of the identity.

On first run the helper asks for **System Audio Recording** permission. This is a
narrower grant than screen recording, gives no access to screen contents, and is
remembered.

### 4. The smart bulb (optional)

```sh
TUYA_API_KEY=... TUYA_API_SECRET=... TUYA_REGION=in ./scripts/tuya-setup.sh keys
./scripts/tuya-setup.sh scan
./scripts/tuya-setup.sh configure
./scripts/tuya-setup.sh test        # walks the bulb red → green → blue
```

Control is entirely local at runtime, but each Tuya device has a *local key* that
is only obtainable through a free Tuya IoT Cloud project. Create one at
[iot.tuya.com](https://iot.tuya.com), link your app account by QR, and take the
Access ID and Secret from the project's Overview tab. `TUYA_REGION` is `in`, `us`,
`eu` or `cn` and must match the project's data centre — a mismatch returns an
empty device list rather than an error.

Credentials are written to `.resonance/`, which is gitignored and never sent to
the browser.

---

## Running

```sh
npm run build     # build the web app (after any UI change)
npm start         # daemon + UI on http://localhost:4747
```

Open <http://localhost:4747> with music playing.

Other entry points:

```sh
npm start -- --fake   # scripted timeline: no music, no network, no permissions
npm run web           # Vite dev server with hot reload
npm run daemon        # terminal-only view of what the daemon sees
npm test              # 402 tests
```

`--fake` replays a track change, a seek, a pause and a second track on a timer.
The whole UI can be developed against it.

---

## Using it

| Key | |
|---|---|
| `←` `→` | Nudge the lyric offset by 50 ms |
| `s` | Settings |
| `m` | Audio meters |
| `f` | Fullscreen |

### Settings

A tabbed panel covering typography, colour, backdrop, audio, sync and lights.
Values that only matter occasionally sit behind an **Advanced** toggle in each
group.

### Timing

Audio output lags the position a player reports, by an amount that depends on the
output device — Bluetooth is far worse than built-in speakers. Tune the offset by
ear with the arrow keys while listening; it is remembered per browser. Positive
values show lyrics later; Bluetooth usually wants +150 to +300 ms.

### Look

Three dimensions, each independently automatic or pinned:

- **Colour** — `artwork` (sampled from the cover), `midnight`, `paper` (light),
  `neon`, `mono`
- **Typeface** — `serene`, `pulse`, `cascade`, `drift`, `fracture`, `editorial`,
  `marquee`, chosen from lyric density and audio energy
- **Arrangement** — `centred`, `rail` (artwork beside the words), `band`
  (karaoke-style, two lines low)

Whatever the artwork looks like, the accent colour is forced to a 7:1 contrast
ratio against the background, so the words stay readable.

### Audio

Two sources, in settings:

- **native** — the Swift helper taps system audio. Permission once, then never
  again.
- **browser** — in-page capture via `getDisplayMedia`. Works anywhere, but Chrome
  cannot persist a screen-share grant, so it needs the picker every session.

With audio off, the theme takes its energy from a 30-second preview of the track
instead, so tracks still differ from one another.

### Lights

Two colour modes:

| Mode | Hue from | Character |
|---|---|---|
| `palette` | the album artwork | colour belongs to the track; brightness follows the music |
| `spectrum` | the sound itself | repaints continuously; livelier, more restless |

Expect **ambient** sync rather than frame-accurate. A Tuya bulb answers in roughly
50–150 ms over Wi-Fi and drops commands when saturated, so a higher update rate
can look *less* in time. Writes are throttled, coalesced, and skipped when the
colour has not visibly changed. Raise the rate until the light lags, then back
off — around 20/sec was the practical ceiling on the bulb this was built against.

---

## How it works

```
┌──────────────── daemon (Node) ─────────────────┐
│  now-playing ──► lyrics ──► light controller   │
│       │            │              │            │
│       └── WebSocket + static server :4747 ──┐  │
└─────────────────────────────────────────────┼──┘
                                              │
┌──────────── browser @ localhost:4747 ───────▼──┐
│  sync clock ──► line scheduler ──► renderer    │
│  audio features ──► theme ──► WebGL backdrop   │
└────────────────────────────────────────────────┘
```

The **daemon owns facts** — what is playing, what the words are. The **browser
owns time and appearance** — where we are in the song, how it looks, how it moves.
Keeping the animation loop out of the daemon means no IPC in the hot path.

Three helper processes, each speaking NDJSON on stdout:

| Helper | Language | Why |
|---|---|---|
| `vendor/mediaremote-adapter` | perl | reads now-playing from MediaRemote |
| `native/resonance-audio` | Swift | taps system audio, computes FFT features |
| `bridges/tuya-bulb` | Python | drives the bulb over the Tuya LAN protocol |

---

## Why it is built this way

**A daemon, not a Chrome extension.** Extensions are sandboxed to the browser and
cannot see what the Spotify desktop app is playing. Reading system now-playing
state needs a local process. Once that exists, the browser is still the best place
to *render* — real variable fonts, GPU-composited transforms, and text shaping
that canvas cannot match.

**perl, of all things.** Since macOS 15.4, `MRMediaRemoteGetNowPlayingInfo`
answers only Apple-signed processes. `/usr/bin/perl` is one — it reports
`Identifier=com.apple.perl` with an Apple platform signature — so the adapter
loads the framework inside perl and relays the result.

**Native audio rather than the browser's.** Chrome can capture system audio, but
the grant is per-session: every restart means completing the screen-share picker
again. Core Audio process taps sit behind a narrower permission that is granted
once and remembered.

**The daemon owns the bulb.** Only it can open a LAN socket to the device, and it
must keep working when no browser is open. The album palette is computed in the
page with a canvas, so the page sends its colours down; with no page open, the
bulb falls back to spectrum mode rather than going dark.

---

## Layout

```
packages/
  shared/    wire contract, LRC parser, settings schema, colour maths
  daemon/    now-playing sources, lyrics resolver + cache, light control, server
  web/       sync clock, audio sources, theme engine, renderer, settings UI
native/
  resonance-audio/   Swift system-audio helper (Core Audio process tap)
bridges/
  tuya-bulb/         Python bulb bridge (tinytuya)
vendor/
  mediaremote-adapter/   vendored BSD-3 now-playing adapter
scripts/     setup for signing, autostart and the bulb
```

---

## Development

```sh
npm test              # unit tests
npm run typecheck
```

Pure logic is unit-tested: the LRC parser, the browser-title parser, the sync
clock's slew, audio feature extraction, palette contrast, colour mapping and the
light throttle. Anything needing a real device is verified by running it.

Three things are registry-driven, so extending them is additive:

- **A setting** — add a record to `packages/shared/src/settings/schema.ts`.
  Rendering, validation and persistence all derive from it.
- **A typeface family** — add a descriptor to `packages/web/src/theme/families/`
  and a block of CSS. Selection works over whatever is registered.
- **A backdrop** — add a branch to the fragment shader and an entry in
  `BACKDROP_INDEX`. A test asserts every registered backdrop has a distinct
  branch.

---

## Autostart

```sh
npm run autostart install     # start at login, restart if it exits
npm run autostart status
npm run autostart uninstall
```

Installs a user LaunchAgent — no root, removed cleanly in one command. Logs land
in `.resonance/daemon.log`.

---

## Troubleshooting

**macOS keeps asking for audio permission.** The helper is ad-hoc signed. Run
`./scripts/signing-cert.sh`, then rebuild. If `codesign` hangs, it is waiting on a
keychain dialog — click *Always Allow*, or grant access once with:

```sh
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$(read -s -p 'password: ' p; echo "$p")" ~/Library/Keychains/login.keychain-db
```

**No lyrics for a track.** LRCLIB has no entry for it. The display falls back to
plain lyrics, then to an ambient visual — it should never be blank. Obscure,
non-English and very new releases miss most often.

**Lyrics are consistently early or late.** Adjust the offset with the arrow keys
while listening. This is output latency, not a sync fault.

**The Tuya step fails with a permissions error.** The IoT Core trial expires.
Cloud → Project management → Upgrade IoT Core Plan → Trial edition → *Extend trial
period*, then retry in a few minutes. Also check `TUYA_REGION` matches the
project's data centre, and that the device appears under the project's Devices
tab — re-pairing a bulb issues it a **new device ID and local key**.

**The bulb stops responding.** It is being pushed too hard. Lower the update rate
in settings. The daemon reconnects with backoff; the display is unaffected.

**The display looks frozen.** Chrome suspends `requestAnimationFrame` in
backgrounded tabs. Bring the window to the front — it catches up by itself.

---

## Credits

- [**mediaremote-adapter**](https://github.com/ungive/mediaremote-adapter) by
  ungive (BSD-3-Clause, vendored with its licence) — now-playing access
- [**LRCLIB**](https://lrclib.net) — time-synced lyrics, free and without an API
  key
- [**tinytuya**](https://github.com/jasonacox/tinytuya) — Tuya LAN protocol
- **iTunes Search API** — 30-second previews used to characterise tracks

Lyrics are fetched for personal display only and are the property of their
respective owners.
