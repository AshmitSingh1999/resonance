# @resonance/daemon

The local process. It owns **facts**: what is playing, what the words are, and
what the bulb should do. It serves the web app and pushes state to it over a
WebSocket.

It deliberately does **not** own time or appearance. The animation loop lives in
the browser, so there is no IPC in the hot path.

## Depends on

`@resonance/shared` for the wire contract. Spawns three child processes: the perl
MediaRemote adapter, the Swift audio helper, and the Python bulb bridge.

## Modules

| Directory | Owns |
|---|---|
| `nowplaying/` | what is playing and where in the track |
| `lyrics/` | finding the words, and caching the answer |
| `audio/` | system-audio features from the helper; track previews |
| `light/` | mapping audio to colour, rate limiting, driving the bulb |
| `server.ts` | static hosting, WebSocket, the preview proxy |
| `index.ts` | wiring: subscribes sources, broadcasts, replays state on connect |

### nowplaying

`NowPlayingSource` is an interface with three implementations: `mediaRemote`
(real), `positionProbe` via AppleScript (position only), and `fake` (a scripted
timeline). The interface exists because the real one depends on a private-API
workaround that an OS update could break.

`fake.ts` replays a track change, seek, pause, resume and second track on a timer.
The entire UI can be built against it with no music, no network and no
permissions — it is worth more than it looks.

### lyrics

`resolver.ts` walks a ladder: exact signature → ranked search → plain lyrics →
nothing. `cache.ts` stores results in SQLite via Node's built-in `node:sqlite`.

### light

`mapping.ts` turns an audio frame into HSV; `throttle.ts` decides whether it is
worth sending; `musicData.ts` encodes it for the device; `bridge.ts` supervises
the Python process. `controller.ts` joins them.

## Decisions worth not undoing

**The adapter's `get` command is unreliable; `stream` is not.** On the tested
build `get` returns an empty payload even while a track is plainly playing — five
calls out of five, not a race — while `stream` reports correctly at the same
moment. Polling `get` produced spurious "nothing playing" transitions. Position
therefore comes from AppleScript for scriptable players, and from extrapolating
`elapsedTime` as of `timestamp` otherwise.

**Spotify's AppleScript units are inconsistent**: `player position` is in seconds,
`duration of current track` is in milliseconds. Apple Music uses seconds for both.

**Tracks are compared whole, not by id.** Players fetch artwork lazily, so it
arrives in a later diff *without* changing the track id. Keying re-broadcast on
the id alone dropped it silently — and the theme's palette depends on it. The
client distinguishes "new song" from "same song, better data", because treating
late artwork as a new song would reset the clock mid-play.

**Lyrics ranking never hard-filters on duration.** Searching a base title returns
versions minutes apart from the one playing; a tolerance would reject all of them
and leave nothing to show. Duration ranks candidates instead.

**Synced and plain lyrics are separate tiers, not a weight.** Plain lyrics cannot
be displayed in time at all, so any plausible synced record outranks any plain
one; match quality only orders within a tier.

**Network failures are not cached as misses.** Being unable to *ask* is not the
same as learning there are no lyrics, and caching it would blank a track for the
whole miss TTL over a momentary blip. Genuine misses *are* cached, with a TTL, so
replaying an unknown album does not hammer a free service.

**The light throttle coalesces rather than queues.** Audio arrives at 30Hz and the
bulb takes a fraction of that. A queue would grow under load and the light would
fall further behind exactly when the music was busiest; dropping is safe because a
fresher frame is never more than ~33ms away.

**Hue distance is circular.** Numerically |359 − 2| is 357, but they are three
degrees apart. Without this a colour hovering around red fires a network write
every frame.

**Device credentials never cross to the browser.** `light.json` holds the local
key; only behavioural settings are sent. There is a test asserting this.

## Looks broken but isn't

**An empty adapter payload means "stopped", not "no update".** Merging it into
held state would leave a ghost track on screen.

**The stream can be silent for minutes.** It emits on *change* only. Position must
be sampled separately or the client clock has nothing to discipline it.

**The daemon works with no browser open.** That is deliberate — the bulb keeps
running, falling back to spectrum mode since the palette needs a canvas.

## Extending it

Add a now-playing source by implementing `NowPlayingSource`. Add a lyrics source
by following `lyrics/lrclib.ts` and extending the resolver's ladder.
