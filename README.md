# Resonance

A Cotodama-style kinetic lyric display for macOS: whatever is playing — Spotify,
Apple Music, or a browser tab — the words appear in sync, rendered as typography
that moves with the music.

## How it works

Two processes, one shared contract.

- **`resonanced`** (Node) owns *facts*: what is playing and what the words are.
  It reads now-playing state from macOS and fetches lyrics from LRCLIB.
- **The browser page** owns *time and appearance*: where we are in the song, how
  it should look, and how it moves. It taps system audio for a live FFT, derives
  a palette from the album artwork, and renders the typography.

The theme engine lives in the page rather than the daemon. It needs a canvas to
sample artwork and the live audio features to judge energy, both of which are
browser-only; running it in the daemon would mean shipping artwork out, taking
derived values back, and carrying an image-decoding dependency for no gain.

Keeping the animation loop out of the daemon means no IPC in the hot path.

## Why a local daemon and not just a Chrome extension

Extensions are sandboxed to the browser, so they cannot observe the Spotify or
Apple Music desktop apps. Reading system now-playing state requires a local
process. Once that exists, the browser is still the best place to *render*.

## Verified platform notes

Established by probing macOS 26.3 directly, not assumed:

| Finding | Detail |
|---|---|
| MediaRemote is gated, not closed | Since macOS 15.4 `MRMediaRemoteGetNowPlayingInfo` answers only Apple-signed processes. `/usr/bin/perl` reports `Identifier=com.apple.perl`, `Authority=Software Signing`, `Platform identifier=26` — so the adapter reaches it through perl. |
| Full metadata is available | `title`, `artist`, `album`, `duration`, `elapsedTime`, `timestamp`, `playing`, `playbackRate`, `artworkData`, `artworkMimeType`. |
| The stream is diff-based | It opens with `{"diff":false,"payload":{}}`, then a full snapshot, then diffs where `null` means "key removed". |
| The stream can be silent for minutes | It emits on *change* only, so position must be sampled separately or the client clock has nothing to discipline it. |
| **`get` is unreliable; `stream` is not** | On this build `get` returns `payload: {}` even while a track is plainly playing (5/5 calls, not a race), while `stream` reports correctly at the same moment. Polling `get` produced spurious "nothing playing" transitions, so position comes from AppleScript instead. |
| `--now` is the *worse* position source | It adds an `elapsedTimeNow` estimate documented as up to a second out. The accurate route is `elapsedTime` as of `timestamp`, extrapolated locally — which measurement confirms lands within a second of truth. |
| Spotify and Apple Music are scriptable | `player position` over AppleScript is ground truth, costs ~130ms, and needs no extrapolation. Promoted from planned fallback to the primary position channel for these players. |
| Spotify's AppleScript units are inconsistent | `player position` is in **seconds**, `duration of current track` is in **milliseconds**. Apple Music uses seconds for both. |
| A full-song waveform cannot be fetched | Lyrics are crowdsourced text; audio is copyrighted and DRM'd, so there is no LRCLIB for waveforms. Spotify's `audio-analysis` — beats, bars, per-segment loudness — was exactly this and was deprecated on 27 Nov 2024 (403 for new apps; Feb 2026 added a Premium + 250k MAU requirement). What remains is 30-second previews and track-level scalars. |
| Process taps avoid the screen-share picker | Core Audio taps sit behind `NSAudioCaptureUsageDescription` — *System Audio Recording Only* — which is narrower than screen recording and is granted once. `AudioDeviceStart` is what triggers the prompt; nothing asks before that. |
| OpenSSL 3 cannot make a PKCS#12 macOS will import | It defaults to a MAC the Security framework rejects, failing with "MAC verification failed (wrong password?)" — which misleadingly blames the password. Needs `-macalg sha1 -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES` and a non-empty password. |
| Browser capture works but cannot persist | Chrome's `getDisplayMedia({audio:true})` captures the Mac's output, but the grant is per-session. The picker can also be completed *without* ticking "Share system audio", yielding a video track and no audio — detected and reported rather than left as silence. |
| FFT bin mapping confirmed against Web Audio | At 48kHz with `fftSize` 2048 the bin width is 23.438Hz over 1024 bins, and a tone's peak bin is `round(hz / binWidth)` — measured with oscillators, at a gain low enough not to saturate bins at 255. |
| Contrast must be checked on the *painted* colour | The floor was enforced on unrounded floats while the page paints an 8-bit hex triple, so results landed at 6.99 — passing internally, failing in the browser. Every contrast check now quantises first. |
| A changed preference *type* needs migration | Merging stored preferences over defaults is not enough when a field's type changes: `backdrop` went from boolean to an id, and the stale `true` reached the shader as an unknown key, silently collapsing every backdrop onto one branch. Stored preferences are now validated field by field. |
| Artwork arrives late | Players fetch cover art lazily, so it turns up in a diff *after* the track event and without changing the track id. Keying re-broadcast on the id alone dropped it silently — and the palette depends on it. Tracks are now compared whole, and the client distinguishes "new song" from "same song, better data". |
| Hidden tabs stop rendering | Chrome suspends `requestAnimationFrame` for unpainted tabs, so the display freezes while the socket keeps running. It self-heals on return because the clock extrapolates from its last sample, and the page asks for a fresh one on `visibilitychange`. |
| LRCLIB matches remixes directly | An exact-signature `/api/get` found `Lioness - Francis Mercier Remix` (193s) with synced lyrics. |
| Duration must rank, not filter | Searching the base title returned 156s and 173s versions against a 193s remix; a ±3s hard filter would have rejected every one. |
| Synced vs plain is a tier, not a weight | Plain lyrics cannot be displayed in time at all, so any plausible synced record outranks any plain one; match quality only orders within a tier. |

## Setup

Requires macOS, Node 22+, and Xcode command line tools.

```sh
npm install

# Build the MediaRemote adapter framework (once)
brew install cmake
cd vendor/mediaremote-adapter && mkdir -p build && cd build && cmake .. && cmake --build .

# Native audio capture (once) — certificate first, then build
./scripts/signing-cert.sh
./native/resonance-audio/build.sh
```

The certificate is not optional ceremony. macOS keys its permission record to a
binary's **signing identity**: an ad-hoc signature is a hash of the binary, so
every rebuild is a new identity and macOS asks again. Measured on this machine:

| Signing | Designated requirement | Survives a rebuild |
|---|---|---|
| self-signed cert | `identifier + certificate leaf` | yes |
| ad-hoc | `cdhash H"…"` | no |

The certificate is reported *untrusted* — expected and harmless. That affects
Gatekeeper verification, not the stability of the identity.

## Running

```sh
npm run build             # build the web UI (once, or after UI changes)
npm start                 # daemon + UI at http://localhost:4747
npm start -- --fake       # same, driven by a scripted timeline instead of music

npm run web               # Vite dev server with hot reload, proxies to the daemon
npm run daemon            # terminal-only view, no browser
npm test                  # unit tests
```

Open <http://localhost:4747>.

| Key | Action |
|---|---|
| `←` `→` | Nudge the lyric timing offset by 50ms. Remembered per browser. |
| `m` | Toggle the audio debug meters (visible only while audio reactivity is on). |
| `s` | Open settings — colour, typography, backdrop, layout, timing. |
| `f` | Fullscreen. |

The look is composed from **four dimensions**, each independently automatic or
pinned in settings — so a disagreeable guess is corrected one dimension at a time
rather than by overriding everything:

| Dimension | Options |
|---|---|
| **Colour** | artwork · midnight · paper (light) · neon · mono |
| **Typography** | serene · pulse · cascade · drift · fracture · editorial · marquee |
| **Backdrop** | auto · waves · rings · streaks · flow · scan · none |
| **Layout** | centred · rail · band |

Colour is sampled from the album artwork by default, with the accent forced to a
7:1 contrast floor so it stays legible whatever the cover looks like. Typography
is picked from lyric density and audio energy. Adding a family means adding a
descriptor, a block of CSS and a shader branch; selection works over whatever is
registered.

| Family | Suits | Treatment |
|---|---|---|
| **Serene** | sparse, calm | soft serif, wide leading, slow swells |
| **Pulse** | dense, forceful | heavy caps, beat-snapped scale, expanding rings |
| **Cascade** | rapid delivery | words stagger in, drifting vertical streaks |
| **Drift** | ambient, few words | thin geometric type travelling through depth |
| **Fracture** | aggressive | monospaced caps, chromatic split, torn scanlines |
| **Editorial** | mid-tempo, wordy | large serif, magazine stillness |
| **Marquee** | forceful, few words | wide condensed caps with a lateral drift |

The engine's choice is a heuristic and will sometimes disagree with you, so any
family can be pinned in settings (`s`). Pinning keeps the album's palette and
takes only the typography from the chosen family.

### Audio reactivity

Two sources, chosen in settings:

- **native** (default) — the daemon runs a small Swift helper that taps system
  audio through Core Audio. macOS asks **once** for *System Audio Recording*
  permission and remembers it. No screen sharing, ever.
- **browser** — in-page capture via `getDisplayMedia`. Works anywhere, but Chrome
  cannot persist a screen-share grant, so it needs the picker every session
  (choose a screen **and** tick "Share system audio").

With audio off entirely, the daemon still fetches the track's 30-second preview
and the theme takes its energy from that — otherwise every track reads as quiet.

Running against live playback resolves lyrics and prints each line as it becomes
current — the terminal equivalent of what the renderer will do.

The `--fake` source replays track change, seek, pause, resume and a second track
on a timer. It exists so the resolver, server and entire UI can be built and
demonstrated without music playing, without a network, and without depending on a
private API.

## Smart bulb sync (optional)

Drives a Tuya-platform smart bulb — Wipro Next Smart Home and most white-labels —
from the same audio features the display uses.

```sh
./scripts/tuya-setup.sh wizard    # Tuya account, then fetch the local key
./scripts/tuya-setup.sh scan      # find the bulb's IP and protocol version
./scripts/tuya-setup.sh test      # walk red/green/blue to prove control
```

Then enable it in settings (`s` → Lights).

**Why a cloud account is needed once.** Control is entirely local at runtime, but
each device has a *local key* that is only obtainable through a Tuya IoT Cloud
developer project. The key is fetched once and stored in `.resonance/light.json`;
re-pairing the bulb invalidates it.

**The trial expires.** If the wizard fails with a permissions error (code
`28841002`), go to Cloud → Project management → Upgrade IoT Core Plan → Trial
edition → *Extend trial period*, fill the short form, and retry in a few minutes.

**Two modes:**

| Mode | Hue from | Feels like |
|---|---|---|
| `palette` | the album artwork, sent down by the page | colour belongs to the track; only brightness follows the audio |
| `spectrum` | the sound itself, warm to cool by brightness | livelier, repaints continuously |

Palette mode needs a browser tab open, since the palette is derived with a canvas.
Without one it falls back to spectrum rather than going dark.

**On the update rate.** A Tuya bulb answers in roughly 50–150ms and drops commands
when saturated, so a higher rate can look *less* in time. The daemon throttles,
coalesces, and skips imperceptible changes; the slider's useful setting is
whatever your bulb manages before it starts lagging. Expect ambient sync, not
frame-accurate — the latency is inherent to Wi-Fi and the firmware.

## Autostart

```sh
npm run autostart install     # start at login, restart if it exits
npm run autostart status
npm run autostart uninstall
```

Installs a user LaunchAgent — no root, and removed cleanly in one command. Logs
land in `.resonance/daemon.log`.

## Forced alignment (not implemented)

LRCLIB timings are per line, so the word sweep interpolates across each line in
proportion to word length. Deriving real per-word timings means running local
speech recognition with word timestamps over the captured audio and aligning it
against the known lyric text.

This is deliberately left out rather than half-built: it needs a speech model
downloaded to the machine (hundreds of megabytes to a few gigabytes depending on
the choice), an audio buffering path that currently does not exist, and a
whole alignment stage. The `words` field is already in the wire contract and the
renderer already accepts per-word offsets, so it is additive when wanted.

## Layout

```
packages/
  shared/   wire contract, LRC parser, browser-title parser  (pure, tested)
  daemon/   now-playing sources, lyrics resolver + cache, theme, server
  web/      sync clock, lyric scheduler, audio sources, theme, renderer
native/
  resonance-audio/       Swift system-audio helper (Core Audio process tap)
vendor/
  mediaremote-adapter/   BSD-3 upstream, built locally
```

## Status

- [x] Phase 0 — adapter verified on macOS 26
- [x] Phase 1 — now-playing daemon with real and fake sources, sync model validated against live playback
- [x] Phase 2 — LRCLIB fetch, duration-aware SQLite cache, fallback ladder
- [x] Phase 3 — WebSocket server + browser page, sync clock, offset calibration
- [x] Phase 4 — system-audio capture, FFT features, onset detection, debug meters
- [x] Phase 5 — theme engine, artwork palette, Serene and Pulse families
