import { describe, it, expect } from 'vitest';
import { rgbToHsv, hsvToRgb, hexToRgb } from '../src/colour.js';

describe('rgbToHsv', () => {
  it('reads primary hues at their expected angles', () => {
    expect(rgbToHsv([255, 0, 0]).h).toBeCloseTo(0, 1);
    expect(rgbToHsv([0, 255, 0]).h).toBeCloseTo(120, 1);
    expect(rgbToHsv([0, 0, 255]).h).toBeCloseTo(240, 1);
  });

  it('reports greys as fully unsaturated', () => {
    for (const level of [0, 64, 128, 200, 255]) {
      expect(rgbToHsv([level, level, level]).s).toBe(0);
    }
  });

  it('scales value with brightness', () => {
    expect(rgbToHsv([255, 255, 255]).v).toBeCloseTo(1, 3);
    expect(rgbToHsv([0, 0, 0]).v).toBe(0);
  });

  it('keeps hue in 0..360 and the rest in 0..1', () => {
    for (const rgb of [[10, 200, 90], [255, 128, 0], [3, 3, 250]] as [number, number, number][]) {
      const hsv = rgbToHsv(rgb);
      expect(hsv.h).toBeGreaterThanOrEqual(0);
      expect(hsv.h).toBeLessThan(360);
      for (const component of [hsv.s, hsv.v]) {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(1);
      }
    }
  });

  it('places hue just below 360 rather than wrapping past it', () => {
    // A red leaning slightly toward magenta sits at the top of the circle, and
    // must not come back as 360, which some ranges treat as out of bounds.
    const hsv = rgbToHsv([255, 0, 8]);
    expect(hsv.h).toBeGreaterThan(300);
    expect(hsv.h).toBeLessThan(360);
  });
});

describe('hsvToRgb', () => {
  it('round-trips the primaries', () => {
    for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [200, 120, 40]] as [number, number, number][]) {
      const back = hsvToRgb(rgbToHsv(rgb));
      expect(back[0]).toBeCloseTo(rgb[0], -1);
      expect(back[1]).toBeCloseTo(rgb[1], -1);
      expect(back[2]).toBeCloseTo(rgb[2], -1);
    }
  });

  it('produces grey for zero saturation', () => {
    const [r, g, b] = hsvToRgb({ h: 210, s: 0, v: 0.5 });
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('hexToRgb', () => {
  it('parses a six-digit hex colour', () => {
    expect(hexToRgb('#e27a73')).toEqual([226, 122, 115]);
  });

  it('is case insensitive', () => {
    expect(hexToRgb('#AABBCC')).toEqual([170, 187, 204]);
  });

  it('returns null for anything it does not understand', () => {
    // The palette can carry rgb() or color-mix() values, and guessing at those
    // produced a plausible-looking but wholly wrong colour once already.
    expect(hexToRgb('rgb(1,2,3)')).toBeNull();
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });
});
