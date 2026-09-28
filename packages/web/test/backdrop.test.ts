import { describe, it, expect } from 'vitest';
import { parseColour } from '../src/gl/backdrop.js';
import { BACKDROP_INDEX } from '../src/gl/shaders.js';
import { FAMILIES } from '../src/theme/families/index.js';

describe('parseColour', () => {
  it('parses a six-digit hex colour', () => {
    expect(parseColour('#e27a73', [0, 0, 0])).toEqual([226, 122, 115]);
  });

  it('parses an rgb() string', () => {
    expect(parseColour('rgb(8, 9, 12)', [0, 0, 0])).toEqual([8, 9, 12]);
  });

  it('parses an rgba() string, ignoring alpha', () => {
    expect(parseColour('rgba(245, 246, 248, 0.28)', [0, 0, 0])).toEqual([245, 246, 248]);
  });

  it('falls back on colour syntax it does not understand', () => {
    // Scraping digits out of these would produce a plausible-looking but wholly
    // wrong colour, which is worse than declining to parse them.
    expect(parseColour('oklch(0.7 0.1 30)', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColour('color-mix(in oklab, #fff 40%, transparent)', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColour('hsl(210 40% 50%)', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColour('', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseColour('#fff', [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('accepts the space-separated rgb syntax browsers now return', () => {
    expect(parseColour('rgb(8 9 12)', [0, 0, 0])).toEqual([8, 9, 12]);
  });

  it('is case insensitive', () => {
    expect(parseColour('#AABBCC', [0, 0, 0])).toEqual([170, 187, 204]);
  });
});

describe('shader backdrop mapping', () => {
  it('maps every backdrop to a distinct branch', () => {
    const branches = Object.values(BACKDROP_INDEX);
    expect(new Set(branches).size).toBe(branches.length);
  });

  it('resolves every family default backdrop to a real branch', () => {
    // Without this, adding a family would silently fall back to branch 0 and the
    // backdrop would quietly stop matching the typography. This check already
    // caught exactly that once.
    for (const family of FAMILIES) {
      expect(BACKDROP_INDEX[family.defaultBackdrop]).toBeTypeOf('number');
    }
  });

  it('has no branch for `none`, which is drawn by not mounting the canvas', () => {
    expect(BACKDROP_INDEX['none']).toBeUndefined();
  });
});
