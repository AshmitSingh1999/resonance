import { describe, it, expect } from 'vitest';
import {
  BAND_COUNT,
  WAVEFORM_POINTS,
  WAVEFORM_CENTRE,
  aggregateLogBands,
  decodeBase64Bytes,
  encodeBase64Bytes,
  downsampleWaveform,
} from '../src/spectrum.js';

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2;

/** Magnitudes with energy only between two frequencies. */
function tone(lowHz: number, highHz: number, level = 255): Uint8Array {
  const data = new Uint8Array(BINS);
  const binWidth = SAMPLE_RATE / FFT_SIZE;
  for (let i = 0; i < BINS; i += 1) {
    const hz = i * binWidth;
    if (hz >= lowHz && hz <= highHz) data[i] = level;
  }
  return data;
}

const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);

describe('aggregateLogBands', () => {
  it('always returns exactly the declared band count', () => {
    expect(aggregateLogBands(tone(20, 16_000), SAMPLE_RATE, FFT_SIZE)).toHaveLength(BAND_COUNT);
  });

  it('puts a low tone in the early bands and not the late ones', () => {
    const bands = aggregateLogBands(tone(40, 120), SAMPLE_RATE, FFT_SIZE);
    const early = sum(bands.slice(0, BAND_COUNT / 4));
    const late = sum(bands.slice((BAND_COUNT * 3) / 4));
    expect(early).toBeGreaterThan(0);
    expect(late).toBe(0);
  });

  it('puts a high tone in the late bands and not the early ones', () => {
    const bands = aggregateLogBands(tone(9_000, 15_000), SAMPLE_RATE, FFT_SIZE);
    expect(sum(bands.slice((BAND_COUNT * 3) / 4))).toBeGreaterThan(0);
    expect(sum(bands.slice(0, BAND_COUNT / 4))).toBe(0);
  });

  it('spreads broadband energy across the whole display, not just the left', () => {
    // The reason bands are log-spaced. With linear spacing almost all musical
    // energy lands in the first few bars and the rest of the display barely
    // moves — the classic way this kind of visualizer looks broken.
    const bands = aggregateLogBands(tone(20, 16_000), SAMPLE_RATE, FFT_SIZE);
    const lit = [...bands].filter((v) => v > 0).length;
    expect(lit).toBeGreaterThan(BAND_COUNT * 0.8);
  });

  it('gives every band a value for full-range input, leaving no dead bars', () => {
    const bands = aggregateLogBands(tone(20, 20_000), SAMPLE_RATE, FFT_SIZE);
    expect([...bands].every((v) => v > 0)).toBe(true);
  });

  it('reports silence as all zeros', () => {
    expect(sum(aggregateLogBands(new Uint8Array(BINS), SAMPLE_RATE, FFT_SIZE))).toBe(0);
  });

  it('scales with level', () => {
    const quiet = sum(aggregateLogBands(tone(200, 4_000, 40), SAMPLE_RATE, FFT_SIZE));
    const loud = sum(aggregateLogBands(tone(200, 4_000, 240), SAMPLE_RATE, FFT_SIZE));
    expect(loud).toBeGreaterThan(quiet);
  });

  it('survives an empty or undersized input rather than throwing', () => {
    expect(aggregateLogBands(new Uint8Array(0), SAMPLE_RATE, FFT_SIZE)).toHaveLength(BAND_COUNT);
    expect(sum(aggregateLogBands(new Uint8Array(0), SAMPLE_RATE, FFT_SIZE))).toBe(0);
  });

  it('is monotonic in band centre frequency', () => {
    // Two adjacent tones should light adjacent bands in the same order.
    const low = aggregateLogBands(tone(100, 130), SAMPLE_RATE, FFT_SIZE);
    const high = aggregateLogBands(tone(4_000, 5_000), SAMPLE_RATE, FFT_SIZE);
    const peak = (b: Uint8Array) => [...b].indexOf(Math.max(...b));
    expect(peak(low)).toBeLessThan(peak(high));
  });
});

describe('downsampleWaveform', () => {
  it('returns exactly the declared point count', () => {
    expect(downsampleWaveform(new Uint8Array(4096).fill(128))).toHaveLength(WAVEFORM_POINTS);
  });

  it('preserves silence as the centre value', () => {
    const points = downsampleWaveform(new Uint8Array(1024).fill(128));
    expect([...points].every((v) => v === 128)).toBe(true);
  });

  it('traces both sides of a swinging wave', () => {
    const input = new Uint8Array(1024);
    for (let i = 0; i < input.length; i += 1) input[i] = i % 2 === 0 ? 255 : 0;
    const points = downsampleWaveform(input);
    expect(Math.max(...points)).toBeGreaterThan(200);
    expect(Math.min(...points)).toBeLessThan(55);
  });

  it('is not biased toward one side of the centre line', () => {
    // Regression: byte audio centres on 128, so a negative peak sits further
    // from centre than its matching positive one. Choosing "most extreme" pinned
    // every slice downward and the trace rendered lopsided.
    const input = new Uint8Array(1024);
    for (let i = 0; i < input.length; i += 1) {
      input[i] = Math.round(128 + Math.sin(i / 4) * 120);
    }
    const points = downsampleWaveform(input);
    const above = [...points].filter((v) => v > WAVEFORM_CENTRE).length;
    const below = [...points].filter((v) => v < WAVEFORM_CENTRE).length;
    expect(Math.abs(above - below)).toBeLessThan(WAVEFORM_POINTS * 0.25);
  });

  it('handles input shorter than the output without throwing', () => {
    expect(downsampleWaveform(new Uint8Array(10).fill(200))).toHaveLength(WAVEFORM_POINTS);
  });

  it('handles empty input', () => {
    const points = downsampleWaveform(new Uint8Array(0));
    expect([...points].every((v) => v === 128)).toBe(true);
  });
});

describe('base64 bytes', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect([...decodeBase64Bytes(encodeBase64Bytes(bytes))]).toEqual([...bytes]);
  });

  it('round-trips each padding case', () => {
    for (const length of [1, 2, 3, 4, 5, 63, 64, 65]) {
      const bytes = new Uint8Array(length).map((_, i) => i % 256);
      expect(decodeBase64Bytes(encodeBase64Bytes(bytes))).toHaveLength(length);
    }
  });

  it('returns an empty array for malformed input rather than throwing', () => {
    expect(decodeBase64Bytes('not base64!!')).toHaveLength(0);
    expect(decodeBase64Bytes('')).toHaveLength(0);
  });
});
