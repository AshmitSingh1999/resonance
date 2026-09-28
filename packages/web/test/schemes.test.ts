import { describe, it, expect } from 'vitest';
import { applyScheme, SCHEMES } from '../src/theme/schemes.js';
import { contrastRatio, relativeLuminance, paletteFromPixels } from '../src/theme/palette.js';
import type { SchemeId } from '@resonance/shared';

/** An artwork palette built from a solid colour, as the extractor would give. */
function artworkOf(r: number, g: number, b: number) {
  const data = new Uint8ClampedArray(400 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return paletteFromPixels(data);
}

const teal = artworkOf(20, 130, 120);
const ids = SCHEMES.map((s) => s.id);

const parse = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe('applyScheme', () => {
  it('covers every declared scheme id', () => {
    expect(ids).toEqual(['artwork', 'midnight', 'paper', 'neon', 'mono']);
  });

  it.each(ids)('keeps %s legible against its own background', (id) => {
    // The whole reason schemes go through the shared contrast helper.
    const palette = applyScheme(id as SchemeId, teal);
    expect(contrastRatio(parse(palette.accent), parse(palette.background))).toBeGreaterThanOrEqual(7);
  });

  it.each(ids)('keeps %s legible when the artwork is almost white', (id) => {
    const palette = applyScheme(id as SchemeId, artworkOf(250, 250, 248));
    expect(contrastRatio(parse(palette.accent), parse(palette.background))).toBeGreaterThanOrEqual(7);
  });

  it.each(ids)('keeps %s legible when the artwork is almost black', (id) => {
    const palette = applyScheme(id as SchemeId, artworkOf(3, 3, 5));
    expect(contrastRatio(parse(palette.accent), parse(palette.background))).toBeGreaterThanOrEqual(7);
  });

  it.each(ids)('produces %s without any artwork at all', (id) => {
    const palette = applyScheme(id as SchemeId, null);
    expect(contrastRatio(parse(palette.accent), parse(palette.background))).toBeGreaterThanOrEqual(7);
  });

  it('passes the artwork palette through unchanged for the artwork scheme', () => {
    const palette = applyScheme('artwork', teal);
    expect(palette.background).toBe(teal.background);
    expect(palette.accent).toBe(teal.accent);
    expect(palette.light).toBe(false);
  });

  it('reports paper as a light scheme with a light ground', () => {
    const palette = applyScheme('paper', teal);
    expect(palette.light).toBe(true);
    expect(relativeLuminance(...parse(palette.background))).toBeGreaterThan(0.5);
  });

  it('reports every other scheme as dark', () => {
    for (const id of ids.filter((i) => i !== 'paper')) {
      expect(applyScheme(id as SchemeId, teal).light).toBe(false);
    }
  });

  it('makes mono greyscale', () => {
    const palette = applyScheme('mono', teal);
    for (const hex of [palette.background, palette.accent]) {
      const [r, g, b] = parse(hex);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
    }
  });

  it('still distinguishes covers under mono, via their luminance', () => {
    // A greyscale scheme that ignored the artwork entirely would make every
    // album look identical, which defeats sampling it at all.
    const dark = applyScheme('mono', artworkOf(20, 20, 20));
    const light = applyScheme('mono', artworkOf(200, 200, 200));
    expect(dark.background).not.toBe(light.background);
  });

  it('makes neon more saturated than the artwork it came from', () => {
    const sat = ([r, g, b]: [number, number, number]) => Math.max(r, g, b) - Math.min(r, g, b);
    const dull = artworkOf(90, 100, 96);
    expect(sat(parse(applyScheme('neon', dull).accent))).toBeGreaterThan(
      sat(parse(applyScheme('artwork', dull).accent)),
    );
  });

  it('gives midnight a cool ground regardless of a warm cover', () => {
    const [r, , b] = parse(applyScheme('midnight', artworkOf(200, 60, 20)).background);
    expect(b).toBeGreaterThanOrEqual(r);
  });

  it('places dim between background and accent for every scheme', () => {
    for (const id of ids) {
      const p = applyScheme(id as SchemeId, teal);
      const dim = contrastRatio(parse(p.dim), parse(p.background));
      const accent = contrastRatio(parse(p.accent), parse(p.background));
      expect(dim).toBeGreaterThan(1.1);
      expect(dim).toBeLessThan(accent);
    }
  });

  it('is deterministic', () => {
    expect(applyScheme('neon', teal)).toEqual(applyScheme('neon', teal));
  });

  it('emits hex strings the shader parser can read', () => {
    for (const id of ids) {
      const p = applyScheme(id as SchemeId, teal);
      for (const value of [p.background, p.dim, p.accent]) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
