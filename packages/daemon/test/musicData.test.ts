import { describe, it, expect } from 'vitest';
import { encodeMusicData, decodeMusicData } from '../src/light/musicData.js';

describe('encodeMusicData', () => {
  it('reproduces the documented example exactly', () => {
    // From Tuya's own docs: gradient, hue 118, saturation 1000, value 1000,
    // brightness 18, temperature 37.
    expect(
      encodeMusicData({ mode: 'gradient', h: 118, s: 1000, v: 1000, bright: 18, temp: 37 }),
    ).toBe('1007603e803e800120025');
  });

  it('is always 21 characters: one mode digit and five 4-digit fields', () => {
    const encoded = encodeMusicData({ mode: 'jump', h: 0, s: 0, v: 0, bright: 0, temp: 0 });
    expect(encoded).toHaveLength(21);
    expect(encoded).toBe('0'.repeat(21));
  });

  it('uses 0 for jump and 1 for gradient', () => {
    expect(encodeMusicData({ mode: 'jump', h: 1, s: 1, v: 1, bright: 1, temp: 1 })[0]).toBe('0');
    expect(encodeMusicData({ mode: 'gradient', h: 1, s: 1, v: 1, bright: 1, temp: 1 })[0]).toBe('1');
  });

  it('pads every field to four hex digits', () => {
    expect(encodeMusicData({ mode: 'jump', h: 5, s: 5, v: 5, bright: 5, temp: 5 })).toBe(
      '0' + '0005'.repeat(5),
    );
  });

  it('emits lowercase hex, as the device expects', () => {
    const encoded = encodeMusicData({ mode: 'jump', h: 255, s: 255, v: 255, bright: 255, temp: 255 });
    expect(encoded).toBe(encoded.toLowerCase());
  });

  it('clamps hue to 0..360 rather than emitting an out-of-range field', () => {
    // A malformed value is rejected silently by the bulb, so it would look like
    // the light had simply stopped responding.
    expect(decodeMusicData(encodeMusicData({ mode: 'jump', h: 900, s: 0, v: 0, bright: 0, temp: 0 }))!.h)
      .toBe(360);
    expect(decodeMusicData(encodeMusicData({ mode: 'jump', h: -50, s: 0, v: 0, bright: 0, temp: 0 }))!.h)
      .toBe(0);
  });

  it('clamps saturation and value to 0..1000', () => {
    const encoded = encodeMusicData({ mode: 'jump', h: 0, s: 5000, v: -1, bright: 0, temp: 0 });
    const decoded = decodeMusicData(encoded)!;
    expect(decoded.s).toBe(1000);
    expect(decoded.v).toBe(0);
  });

  it('rounds fractional input, since the wire format is integer hex', () => {
    expect(decodeMusicData(encodeMusicData({ mode: 'jump', h: 118.6, s: 0, v: 0, bright: 0, temp: 0 }))!.h)
      .toBe(119);
  });

  it('survives non-finite input rather than emitting NaN', () => {
    const encoded = encodeMusicData({
      mode: 'jump', h: Number.NaN, s: Number.POSITIVE_INFINITY, v: 0, bright: 0, temp: 0,
    });
    expect(encoded).toHaveLength(21);
    expect(encoded).not.toContain('N');
  });
});

describe('decodeMusicData', () => {
  it('round-trips an encoded value', () => {
    const original = { mode: 'gradient' as const, h: 200, s: 800, v: 640, bright: 500, temp: 0 };
    expect(decodeMusicData(encodeMusicData(original))).toEqual(original);
  });

  it('returns null for a string of the wrong length', () => {
    expect(decodeMusicData('100760')).toBeNull();
    expect(decodeMusicData('')).toBeNull();
  });

  it('returns null for non-hex content', () => {
    expect(decodeMusicData('1zzzz03e803e800120025')).toBeNull();
  });
});
