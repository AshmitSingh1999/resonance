import { describe, it, expect } from 'vitest';
import { mapToColour, DIM_FLOOR } from '../src/light/mapping.js';
import type { AudioFrame } from '@resonance/shared';

const frame = (over: Partial<AudioFrame> = {}): AudioFrame => ({
  bass: 0.3, mid: 0.3, treble: 0.3, rms: 0.5, centroid: 0.5, onset: false,
  spectrum: '', waveform: '', ...over,
});

const palette = { accent: '#e27a73', background: '#150b09' };
const options = { maxBrightness: 1 };

describe('mapToColour — palette mode', () => {
  it('takes its hue from the album accent', () => {
    const colour = mapToColour(frame(), 'palette', palette, options);
    // #e27a73 is a warm coral, so hue sits in the reds.
    expect(colour.h).toBeGreaterThanOrEqual(0);
    expect(colour.h).toBeLessThan(30);
  });

  it('holds hue steady as the audio changes', () => {
    // The point of palette mode: colour belongs to the track, so the room is not
    // being repainted several times a second.
    const quiet = mapToColour(frame({ rms: 0.1, centroid: 0.1 }), 'palette', palette, options);
    const loud = mapToColour(frame({ rms: 0.9, centroid: 0.9 }), 'palette', palette, options);
    expect(quiet.h).toBeCloseTo(loud.h, 5);
  });

  it('drives value from loudness', () => {
    const quiet = mapToColour(frame({ rms: 0.1 }), 'palette', palette, options);
    const loud = mapToColour(frame({ rms: 0.9 }), 'palette', palette, options);
    expect(loud.v).toBeGreaterThan(quiet.v);
  });

  it('lifts value on a beat', () => {
    const plain = mapToColour(frame({ rms: 0.4 }), 'palette', palette, options);
    const beat = mapToColour(frame({ rms: 0.4, onset: true }), 'palette', palette, options);
    expect(beat.v).toBeGreaterThan(plain.v);
  });

  it('falls back to spectrum when no palette has arrived', () => {
    // Happens whenever no browser tab is open; the bulb should still work.
    const warm = mapToColour(frame({ centroid: 0.05 }), 'palette', null, options);
    const cool = mapToColour(frame({ centroid: 0.95 }), 'palette', null, options);
    expect(cool.h).toBeGreaterThan(warm.h);
  });

  it('falls back when the accent is a colour format it cannot read', () => {
    const colour = mapToColour(
      frame(), 'palette', { accent: 'color-mix(in oklab, #fff 40%, transparent)', background: '#000' }, options,
    );
    expect(Number.isFinite(colour.h)).toBe(true);
  });
});

describe('mapToColour — spectrum mode', () => {
  it('maps brightness of the sound to hue, warm to cool', () => {
    const warm = mapToColour(frame({ centroid: 0 }), 'spectrum', palette, options);
    const cool = mapToColour(frame({ centroid: 1 }), 'spectrum', palette, options);
    expect(cool.h).toBeGreaterThan(warm.h);
  });

  it('is monotonic across the centroid range', () => {
    const hues = [0, 0.25, 0.5, 0.75, 1].map(
      (centroid) => mapToColour(frame({ centroid }), 'spectrum', palette, options).h,
    );
    for (let i = 1; i < hues.length; i += 1) expect(hues[i]!).toBeGreaterThan(hues[i - 1]!);
  });

  it('ignores the palette entirely', () => {
    const a = mapToColour(frame(), 'spectrum', palette, options);
    const b = mapToColour(frame(), 'spectrum', { accent: '#00ff00', background: '#000' }, options);
    expect(a).toEqual(b);
  });
});

describe('mapToColour — ranges', () => {
  it('always emits values the device accepts', () => {
    for (const rms of [0, 0.5, 1]) {
      for (const centroid of [0, 0.5, 1]) {
        for (const mode of ['palette', 'spectrum'] as const) {
          const colour = mapToColour(frame({ rms, centroid, onset: true }), mode, palette, options);
          expect(colour.h).toBeGreaterThanOrEqual(0);
          expect(colour.h).toBeLessThanOrEqual(360);
          expect(colour.s).toBeGreaterThanOrEqual(0);
          expect(colour.s).toBeLessThanOrEqual(1000);
          expect(colour.v).toBeGreaterThanOrEqual(0);
          expect(colour.v).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('keeps the bulb dimly lit in silence rather than switching it off', () => {
    // A light that blinks out between tracks reads as broken, not as responsive.
    const colour = mapToColour(frame({ rms: 0, onset: false }), 'spectrum', palette, options);
    expect(colour.v).toBeGreaterThanOrEqual(DIM_FLOOR);
  });

  it('respects the brightness ceiling', () => {
    const capped = mapToColour(frame({ rms: 1, onset: true }), 'spectrum', palette, { maxBrightness: 0.5 });
    expect(capped.v).toBeLessThanOrEqual(500);
  });

  it('never exceeds the ceiling even on a beat at full volume', () => {
    const capped = mapToColour(frame({ rms: 1, onset: true }), 'palette', palette, { maxBrightness: 0.3 });
    expect(capped.v).toBeLessThanOrEqual(300);
  });
});
