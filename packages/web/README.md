# @resonance/web

The browser app. It owns **time and appearance**: where we are in the song, how it
looks, and how it moves.

The daemon owns facts; this owns everything that changes every frame. Keeping the
animation loop here means no IPC in the hot path.

## Depends on

`@resonance/shared` for the wire contract. Talks to the daemon over one WebSocket.

## Modules

| Directory | Owns |
|---|---|
| `sync/` | the clock, and which lyric line is current |
| `audio/` | feature extraction, and the two audio sources |
| `theme/` | palette, typeface family, scheme, layout |
| `gl/` | the WebGL backdrop |
| `ui/` | the lyric stage, HUD, progress bar, settings panel |
| `net/` | the WebSocket connection with reconnection |

### sync

`clock.ts` bridges the gap between position samples arriving every few seconds and
the display needing a value every frame. `scheduler.ts` binary-searches the active
line and interpolates a word sweep across it.

### theme

Composed from four independent dimensions — scheme × family × backdrop × layout —
each separately automatic or pinned. `palette.ts` samples the artwork; `engine.ts`
composes; `families/` is a registry of typeface treatments.

### ui

The type layer is DOM, not canvas: real variable fonts, proper shaping, and
GPU-composited transforms. Only the backdrop is canvas.

## Decisions worth not undoing

**The clock slews rather than jumps, and bounds the slew *rate* rather than
fixing a duration.** This is what guarantees it never runs backwards — at a 0.5
bound the corrected rate stays within 0.5×–1.5×, so lyrics never jump back a
line. A fixed window cannot promise that: a 500ms correction squeezed into 300ms
reverses. Corrections above ~1.5s are real seeks and *do* jump.

**Contrast is enforced on the quantised colour.** The floor was being checked on
unrounded floats while the page paints an 8-bit hex triple, so results landed at
6.99 — passing internally, failing in the browser. Every contrast check now
rounds first.

**The lyric stack measures the active line's real offset.** Lines wrap to
different heights depending on length and viewport, so translating by a fixed
per-line step misplaces every line after the first wrapped one. This measurement
is shared across all layouts and must not be forked per layout.

**Words are separated by real whitespace text nodes.** Adjacent `<span>`s with no
whitespace give the browser *no break opportunity*, so the line cannot wrap and
runs off the edge. `margin-right` spaces them visually while hiding this.

**Audio sources sit behind one interface.** Native features arrive over the
socket; browser features come from an in-page analyser. The renderer calls
`read()` and does not care which. Native onsets are latched and cleared on read:
frames arrive at ~30Hz while the renderer reads at 60, so an unlatched onset fires
the beat animation twice and reads as a stutter.

**Theme energy is bucketed before it reaches the engine.** Raw loudness moves
constantly; rebuilding the theme on every change would swap typeface mid-verse.

**Per-frame values are written to CSS custom properties, not React state.** At
60fps, re-rendering the lyric tree to change a number the compositor can act on
alone would be pure waste. The progress bar uses `transform: scaleX()` rather than
`width` for the same reason — `width` triggers layout every frame, and a
transition on it fights a value the frame loop already updates.

**Colour parsing for the shader is strict.** It accepts hex and `rgb()` only.
Scraping digits out of any string turns `oklch(0.7 0.1 30)` into the colour
`[0.7, 0.1, 30]` — near-black and silently wrong — and the stylesheet does use
`color-mix(in oklab, …)`.

## Looks broken but isn't

**The display freezes when the tab is not visible.** Chrome suspends
`requestAnimationFrame` in unpainted tabs while the WebSocket keeps running. The
clock self-heals on return because it extrapolates from its last sample. This has
looked like a bug four separate times — check `document.visibilityState` before
investigating anything else.

**A shader draw returns all-black.** Uniforms are only set inside the render loop,
so a manual `drawArrays` outside it draws with everything at zero, and
`field *= uIntensity` with zero intensity is exactly black. Set the uniforms
before reading pixels back.

**A lyric line looks clipped in a screenshot.** Screenshots are scaled. Check
`scrollWidth` against `clientWidth` before concluding anything overflows.

**Synthetic keyboard events do nothing.** They need the tab to have OS focus.
Click the control instead when testing.

## Extending it

- **A typeface family** — add a descriptor to `theme/families/` plus a CSS block.
  Selection works over whatever is registered.
- **A backdrop** — add a branch to the fragment shader and an entry in
  `BACKDROP_INDEX`. A test asserts every registered backdrop has a distinct
  branch; it has already caught a missing one.
- **A setting** — add it to the shared schema. The panel renders whatever is
  declared.
