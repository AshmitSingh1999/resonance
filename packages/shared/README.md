# @resonance/shared

Types and pure logic used by **both** the daemon and the browser.

Nothing here touches the network, the filesystem, the DOM or Core Audio. If a
module needs any of those, it belongs in `daemon` or `web` instead.

## Depends on

Nothing. Everything else depends on this, which is why changes here are the least
local changes in the project — a field added to `ServerMsg` is a change to a
contract between two processes that are versioned and restarted independently.

## Modules

| File | Owns |
|---|---|
| `types.ts` | the wire contract: `Track`, `Lyrics`, `Theme`, `ServerMsg`, `ClientMsg` |
| `lrc.ts` | parsing `.lrc` into timed lines |
| `titleParser.ts` | turning a browser page title into candidate artist/title pairs; cache keys |
| `spectrum.ts` | FFT bands and waveform envelope, shared so both audio sources agree |
| `colour.ts` | RGB↔HSV, hex parsing |
| `settings/schema.ts` | every user-facing setting, declared as data |
| `settings/validate.ts` | validation generated from that schema |

## Decisions worth not undoing

**`cacheKeyOf` excludes duration, deliberately.** Duration is continuous, and any
bucketing of it into an equality key has a boundary that two near-identical
reports can straddle — which fragments the cache. Recordings of different length
are separated at *lookup* time by a tolerance comparison instead. `trackIdOf`
does include it, because within one player the reported duration is deterministic
and a switch between two cuts of a song should read as a track change.

**Spectrum bands are log-spaced.** Musical energy concentrates at the low end, so
linear FFT bins put nearly everything in the leftmost few bars and leave the rest
of a display motionless. This is the usual reason a spectrum visualizer looks
broken rather than merely plain.

**Band aggregation takes the peak, not the mean.** A mean across a wide high band
washes out transients, and bars that do not answer a cymbal look disconnected
from the music.

**The waveform downsampler alternates max and min per slice.** Two alternatives
are both wrong. Averaging collapses a fast signal toward the centre, so the trace
flattens exactly when the music is busiest. Taking the single most extreme sample
*looks* symmetric but is not: the byte range 0–255 centres on 128, so a negative
peak is always fractionally further from centre than the matching positive one,
and every slice resolves downward — a trace visibly pinned to one side.

**Base64 is hand-rolled.** Node has `Buffer` and browsers have `atob`; this runs
in both. One implementation that the tests actually exercise beats a branch where
only one side is ever covered.

**Settings are declared once.** A setting used to be written three times — a
control, a validator, a type — and those drifted apart. Rendering, validation and
persistence now all derive from the schema.

## Looks broken but isn't

**`aggregateLogBands` returns a value for bands narrower than one FFT bin.** At
the low end several bands map to the same bin. That is expected and correct; the
alternative is silent bars.

**`sanitiseSettings` discards values rather than merging them.** That is the
point. A stored value whose *type* no longer matches is replaced, not kept —
`backdrop` was once a boolean, and merging the stale value over the new default
sent an unknown key to the shader that silently collapsed every backdrop onto one
branch.

## Extending it

Add a setting by adding a record to `settings/schema.ts`. Nothing else needs
touching: the panel renders it, validation covers it, and persistence routes it
by its `owner` field.
