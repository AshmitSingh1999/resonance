import { describe, it, expect } from 'vitest';
import {
  analyseSpectrum,
  binForFrequency,
  OnsetDetector,
  smooth,
  type SpectrumContext,
} from '../src/audio/features.js';

/** A 2048-point FFT at 48kHz gives 1024 bins, each ~23.4Hz wide. */
const ctx: SpectrumContext = { sampleRate: 48_000, fftSize: 2048 };
const BINS = 1024;

/** A spectrum with energy only in the bins covering `[lowHz, highHz]`. */
function spectrumIn(lowHz: number, highHz: number, magnitude = 255): Uint8Array {
  const data = new Uint8Array(BINS);
  const from = binForFrequency(lowHz, ctx);
  const to = binForFrequency(highHz, ctx);
  for (let i = from; i <= to && i < BINS; i += 1) data[i] = magnitude;
  return data;
}

describe('binForFrequency', () => {
  it('maps DC to the first bin', () => {
    expect(binForFrequency(0, ctx)).toBe(0);
  });

  it('maps a frequency to the bin covering it', () => {
    // Bin width is sampleRate / fftSize = 23.4375Hz.
    expect(binForFrequency(1000, ctx)).toBe(Math.round(1000 / (48_000 / 2048)));
  });

  it('clamps above Nyquist rather than returning an out-of-range bin', () => {
    expect(binForFrequency(40_000, ctx)).toBe(BINS - 1);
  });

  it('never returns a negative bin', () => {
    expect(binForFrequency(-100, ctx)).toBe(0);
  });
});

describe('analyseSpectrum', () => {
  it('reports full bass energy when the whole band is excited', () => {
    const f = analyseSpectrum(spectrumIn(20, 250), ctx);
    expect(f.bass).toBeCloseTo(1, 1);
  });

  it('keeps low-frequency content out of the treble band', () => {
    const f = analyseSpectrum(spectrumIn(40, 200), ctx);
    expect(f.bass).toBeGreaterThan(0.5);
    expect(f.treble).toBeLessThan(0.05);
  });

  it('keeps high-frequency content out of the bass band', () => {
    const f = analyseSpectrum(spectrumIn(4000, 12_000), ctx);
    expect(f.treble).toBeGreaterThan(0.5);
    expect(f.bass).toBeLessThan(0.05);
  });

  it('reports mid energy for content in the vocal range', () => {
    expect(analyseSpectrum(spectrumIn(250, 2000), ctx).mid).toBeCloseTo(1, 1);
  });

  it('reports band energy in proportion to how much of the band is excited', () => {
    // Band energy is a mean across the band, so exciting half of it reads as
    // roughly half — not as "the band is active". Renderers rely on that being
    // continuous rather than a threshold.
    const half = analyseSpectrum(spectrumIn(250, 1125), ctx).mid;
    const full = analyseSpectrum(spectrumIn(250, 2000), ctx).mid;
    expect(half).toBeGreaterThan(full * 0.35);
    expect(half).toBeLessThan(full * 0.65);
  });

  it('reports silence as zero across every band', () => {
    const f = analyseSpectrum(new Uint8Array(BINS), ctx);
    expect(f).toMatchObject({ bass: 0, mid: 0, treble: 0, rms: 0 });
  });

  it('scales rms with overall level', () => {
    const quiet = analyseSpectrum(spectrumIn(20, 16_000, 40), ctx);
    const loud = analyseSpectrum(spectrumIn(20, 16_000, 240), ctx);
    expect(loud.rms).toBeGreaterThan(quiet.rms);
  });

  it('keeps every feature within 0..1 so renderers can use them directly', () => {
    const f = analyseSpectrum(spectrumIn(20, 20_000, 255), ctx);
    for (const value of Object.values(f)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('places the spectral centroid low for bass-heavy content', () => {
    expect(analyseSpectrum(spectrumIn(40, 200), ctx).centroid).toBeLessThan(0.15);
  });

  it('places the spectral centroid high for bright content', () => {
    expect(analyseSpectrum(spectrumIn(8000, 16_000), ctx).centroid).toBeGreaterThan(0.4);
  });

  it('reports a centroid of zero for silence rather than dividing by zero', () => {
    expect(analyseSpectrum(new Uint8Array(BINS), ctx).centroid).toBe(0);
  });
});

describe('smooth', () => {
  it('moves toward the target rather than jumping to it', () => {
    expect(smooth(0, 1, 0.25)).toBeCloseTo(0.25);
  });

  it('converges on repeated application', () => {
    let value = 0;
    for (let i = 0; i < 60; i += 1) value = smooth(value, 1, 0.25);
    expect(value).toBeCloseTo(1, 3);
  });

  it('applies no smoothing when the factor is 1', () => {
    expect(smooth(0.2, 0.9, 1)).toBeCloseTo(0.9, 10);
  });
});

describe('OnsetDetector', () => {
  const quiet = new Uint8Array(BINS);

  it('does not fire on the very first frame, having nothing to compare', () => {
    expect(new OnsetDetector().push(spectrumIn(20, 16_000))).toBe(false);
  });

  it('does not fire on a steady signal', () => {
    const detector = new OnsetDetector();
    const steady = spectrumIn(20, 16_000, 120);
    let fired = false;
    for (let i = 0; i < 40; i += 1) fired = detector.push(steady) || fired;
    expect(fired).toBe(false);
  });

  it('fires on a sharp rise in energy after a quiet passage', () => {
    const detector = new OnsetDetector();
    for (let i = 0; i < 30; i += 1) detector.push(quiet);
    expect(detector.push(spectrumIn(20, 16_000, 255))).toBe(true);
  });

  it('does not fire on a falling edge, only a rising one', () => {
    const detector = new OnsetDetector();
    const loud = spectrumIn(20, 16_000, 255);
    for (let i = 0; i < 30; i += 1) detector.push(loud);
    expect(detector.push(quiet)).toBe(false);
  });

  it('adapts to a loud passage instead of firing continuously', () => {
    // A sustained loud section should settle, or every frame of a dense mix
    // would read as a beat and the visuals would strobe.
    const detector = new OnsetDetector();
    const loud = spectrumIn(20, 16_000, 255);
    for (let i = 0; i < 10; i += 1) detector.push(loud);
    let fires = 0;
    for (let i = 0; i < 40; i += 1) if (detector.push(loud)) fires += 1;
    expect(fires).toBe(0);
  });
});
