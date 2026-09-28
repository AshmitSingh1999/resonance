import { describe, it, expect } from 'vitest';
import { paletteFromPixels, contrastRatio, relativeLuminance } from '../src/theme/palette.js';

/** Build an RGBA buffer from a list of [r,g,b] repeated `count` times each. */
function pixels(...groups: [[number, number, number], number][]): Uint8ClampedArray {
  const total = groups.reduce((sum, [, count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [[r, g, b], count] of groups) {
    for (let n = 0; n < count; n += 1) {
      data[i++] = r; data[i++] = g; data[i++] = b; data[i++] = 255;
    }
  }
  return data;
}

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('weights green above red above blue, as the eye does', () => {
    const g = relativeLuminance(0, 255, 0);
    const r = relativeLuminance(255, 0, 0);
    const b = relativeLuminance(0, 0, 255);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black against white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio([120, 80, 40], [120, 80, 40])).toBeCloseTo(1, 5);
  });

  it('does not depend on argument order', () => {
    expect(contrastRatio([10, 20, 30], [200, 210, 220])).toBeCloseTo(
      contrastRatio([200, 210, 220], [10, 20, 30]),
      5,
    );
  });
});

describe('paletteFromPixels', () => {
  it('derives a background related to the dominant colour', () => {
    const palette = paletteFromPixels(pixels([[40, 20, 90], 900], [[250, 240, 120], 100]));
    // Dominant here is a deep violet, so the background should be violet-ish:
    // blue channel strongest, and dark enough to read against.
    const [r, g, b] = palette.backgroundRgb;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    expect(relativeLuminance(r, g, b)).toBeLessThan(0.2);
  });

  it('always yields an accent that is legible on the background', () => {
    // The whole point: a palette taken from artwork must still be readable.
    const palette = paletteFromPixels(pixels([[90, 90, 92], 1000]));
    expect(contrastRatio(palette.accentRgb, palette.backgroundRgb)).toBeGreaterThanOrEqual(7);
  });

  it('keeps accent legible even when the artwork is almost white', () => {
    const palette = paletteFromPixels(pixels([[248, 248, 250], 1000]));
    expect(contrastRatio(palette.accentRgb, palette.backgroundRgb)).toBeGreaterThanOrEqual(7);
  });

  it('keeps accent legible even when the artwork is almost black', () => {
    const palette = paletteFromPixels(pixels([[4, 4, 6], 1000]));
    expect(contrastRatio(palette.accentRgb, palette.backgroundRgb)).toBeGreaterThanOrEqual(7);
  });

  it('places the dim colour between background and accent', () => {
    const palette = paletteFromPixels(pixels([[30, 60, 120], 1000]));
    const dim = contrastRatio(palette.dimRgb, palette.backgroundRgb);
    const accent = contrastRatio(palette.accentRgb, palette.backgroundRgb);
    expect(dim).toBeGreaterThan(1.2);
    expect(dim).toBeLessThan(accent);
  });

  it('prefers a saturated colour for the accent over a grey one', () => {
    // Greys dominate many covers; picking one would waste the artwork.
    const palette = paletteFromPixels(pixels([[128, 128, 128], 800], [[220, 40, 40], 200]));
    const [r, g, b] = palette.accentRgb;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(30);
  });

  it('ignores transparent pixels', () => {
    const data = new Uint8ClampedArray(8);
    data.set([255, 0, 0, 0], 0);   // transparent red, must not count
    data.set([20, 40, 80, 255], 4); // opaque blue
    const [r, , b] = paletteFromPixels(data).backgroundRgb;
    expect(b).toBeGreaterThan(r);
  });

  it('falls back to a neutral palette when there are no usable pixels', () => {
    const palette = paletteFromPixels(new Uint8ClampedArray(0));
    expect(contrastRatio(palette.accentRgb, palette.backgroundRgb)).toBeGreaterThanOrEqual(7);
  });

  it('guarantees contrast on the rounded colour, not an unrounded intermediate', () => {
    // Regression: the contrast floor was enforced on floats while the painted
    // colour came from an 8-bit hex triple, so results landed at 6.99 — passing
    // internally, failing in the browser.
    for (const shade of [3, 40, 90, 128, 160, 200, 250]) {
      const data = new Uint8ClampedArray(400 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = shade; data[i + 1] = shade; data[i + 2] = shade; data[i + 3] = 255;
      }
      const p = paletteFromPixels(data);
      const hex = (v: string): [number, number, number] =>
        [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
      expect(contrastRatio(hex(p.accent), hex(p.background))).toBeGreaterThanOrEqual(7);
    }
  });

  it('reports the dominant colour before darkening', () => {
    // Schemes need to know how light the cover actually was; `backgroundRgb` is
    // crushed toward black and cannot answer that.
    const p = paletteFromPixels(pixels([[200, 40, 60], 1000]));
    expect(p.dominantRgb[0]).toBeGreaterThan(150);
    expect(p.backgroundRgb[0]).toBeLessThan(60);
  });

  it('is deterministic for the same input', () => {
    const input = pixels([[10, 90, 70], 500], [[200, 30, 90], 500]);
    expect(paletteFromPixels(input)).toEqual(paletteFromPixels(input));
  });

  it('emits css strings alongside the raw channels', () => {
    const palette = paletteFromPixels(pixels([[10, 20, 30], 100]));
    expect(palette.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.dim).toMatch(/^#[0-9a-f]{6}$/);
  });
});
