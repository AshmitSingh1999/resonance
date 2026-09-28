import { describe, it, expect } from 'vitest';
import { analysePcm } from '../src/theme/previewAnalysis.js';

/** A sine wave of `cycles` periods across `length` samples. */
function sine(length: number, cycles: number, amplitude = 1): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.sin((2 * Math.PI * cycles * i) / length) * amplitude;
  }
  return out;
}

describe('analysePcm', () => {
  it('reports silence as zero on both measures', () => {
    expect(analysePcm(new Float32Array(1000))).toEqual({ energy: 0, brightness: 0 });
  });

  it('returns a silent profile for an empty buffer', () => {
    expect(analysePcm(new Float32Array(0))).toEqual({ energy: 0, brightness: 0 });
  });

  it('reports a loud buffer as more energetic than a quiet one', () => {
    const loud = analysePcm(sine(4096, 40, 0.9)).energy;
    const quiet = analysePcm(sine(4096, 40, 0.05)).energy;
    expect(loud).toBeGreaterThan(quiet);
  });

  it('reports high-frequency content as brighter than low-frequency', () => {
    // Zero-crossing rate stands in for spectral centroid: more crossings per
    // sample means more high-frequency energy.
    const high = analysePcm(sine(4096, 800)).brightness;
    const low = analysePcm(sine(4096, 8)).brightness;
    expect(high).toBeGreaterThan(low);
  });

  it('keeps both measures within 0..1 even for extreme input', () => {
    const extreme = new Float32Array(2048);
    for (let i = 0; i < extreme.length; i += 1) extreme[i] = i % 2 === 0 ? 4 : -4;
    const profile = analysePcm(extreme);
    for (const value of [profile.energy, profile.brightness]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('does not treat digital silence as maximally bright', () => {
    // Exact zeros are not sign changes; counting them would make a silent buffer
    // read as the brightest possible content.
    expect(analysePcm(new Float32Array(4096)).brightness).toBe(0);
  });

  it('is unaffected by a constant DC offset having no crossings', () => {
    const dc = new Float32Array(1024).fill(0.5);
    expect(analysePcm(dc).brightness).toBe(0);
    expect(analysePcm(dc).energy).toBeGreaterThan(0);
  });

  it('scales energy with amplitude monotonically', () => {
    const levels = [0.1, 0.2, 0.3].map((a) => analysePcm(sine(2048, 30, a)).energy);
    expect(levels[0]!).toBeLessThan(levels[1]!);
    expect(levels[1]!).toBeLessThan(levels[2]!);
  });
});
