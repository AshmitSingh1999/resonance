import { describe, it, expect } from 'vitest';
import { lyricDensity, lyricValence } from '../src/theme/traits.js';
import { chooseFamily, FAMILIES } from '../src/theme/families/index.js';
import { buildTheme } from '../src/theme/engine.js';
import type { Lyrics } from '@resonance/shared';

const synced = (lines: [number, number, string][]): Lyrics => ({
  kind: 'synced',
  sourceId: 'test',
  lines: lines.map(([startMs, endMs, text]) => ({ startMs, endMs, text })),
});

describe('lyricDensity', () => {
  it('is words per second across the sung span', () => {
    // Six words between 0s and 3s.
    const d = lyricDensity(synced([[0, 1500, 'one two three'], [1500, 3000, 'four five six']]));
    expect(d).toBeCloseTo(2, 1);
  });

  it('is higher for rapid delivery than for a slow ballad', () => {
    const rapid = lyricDensity(synced([[0, 1000, 'a b c d e f g h']]));
    const slow = lyricDensity(synced([[0, 8000, 'a b']]));
    expect(rapid).toBeGreaterThan(slow);
  });

  it('ignores instrumental gaps when counting words', () => {
    const d = lyricDensity(synced([[0, 2000, 'one two'], [2000, 4000, '']]));
    expect(d).toBeCloseTo(0.5, 1);
  });

  it('returns zero for lyrics with no timings to measure against', () => {
    expect(lyricDensity({ kind: 'plain', sourceId: null, lines: [] })).toBe(0);
    expect(lyricDensity(null)).toBe(0);
  });

  it('does not divide by zero when every line shares one timestamp', () => {
    expect(Number.isFinite(lyricDensity(synced([[1000, 1000, 'a b']])))).toBe(true);
  });
});

describe('lyricValence', () => {
  it('reads warm words as positive', () => {
    expect(lyricValence('love light joy dream sunshine')).toBeGreaterThan(0.2);
  });

  it('reads bleak words as negative', () => {
    expect(lyricValence('hate broken cold alone pain')).toBeLessThan(-0.2);
  });

  it('reads neutral text as near zero', () => {
    expect(Math.abs(lyricValence('the window and the table'))).toBeLessThan(0.2);
  });

  it('is unaffected by casing and punctuation', () => {
    expect(lyricValence('LOVE, light!')).toBeCloseTo(lyricValence('love light'), 5);
  });

  it('returns zero for empty text', () => {
    expect(lyricValence('')).toBe(0);
  });

  it('stays within -1..1 however lopsided the text', () => {
    const v = lyricValence('love '.repeat(200));
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(-1);
  });
});

describe('chooseFamily', () => {
  it('chooses a calm family for sparse, low-energy material', () => {
    expect(chooseFamily({ energy: 0.1, density: 0.2 }).id).toBe('serene');
  });

  it('chooses an emphatic family for dense, high-energy material', () => {
    expect(chooseFamily({ energy: 0.9, density: 0.9 }).id).toBe('pulse');
  });

  it('only ever returns a family that is actually implemented', () => {
    for (const energy of [0, 0.5, 1]) {
      for (const density of [0, 0.5, 1]) {
        expect(FAMILIES.some((f) => f.id === chooseFamily({ energy, density }).id)).toBe(true);
      }
    }
  });

  it('is stable: the same traits always give the same family', () => {
    const traits = { energy: 0.44, density: 0.51 };
    expect(chooseFamily(traits).id).toBe(chooseFamily(traits).id);
  });
});

describe('buildTheme', () => {
  const lyrics = synced([[0, 2000, 'soft light and love'], [2000, 4000, 'quiet dream']]);

  it('produces a complete theme without artwork or audio', () => {
    const theme = buildTheme({ lyrics, palette: null, energy: 0 });
    expect(theme.family).toBeTruthy();
    expect(theme.typeface).toBeTruthy();
    expect(theme.palette.background).toMatch(/^#|rgb/);
  });

  it('uses the artwork palette when one is available', () => {
    const palette = {
      background: '#101020', dim: '#404060', accent: '#f0c060',
      backgroundRgb: [16, 16, 32] as [number, number, number],
      dimRgb: [64, 64, 96] as [number, number, number],
      accentRgb: [240, 192, 96] as [number, number, number],
    };
    expect(buildTheme({ lyrics, palette, energy: 0.2 }).palette.accent).toBe('#f0c060');
  });

  it('raises intensity with audio energy', () => {
    const calm = buildTheme({ lyrics, palette: null, energy: 0 });
    const loud = buildTheme({ lyrics, palette: null, energy: 1 });
    expect(loud.intensity).toBeGreaterThan(calm.intensity);
  });

  it('keeps intensity within 0..1', () => {
    for (const energy of [0, 0.5, 1]) {
      const theme = buildTheme({ lyrics, palette: null, energy });
      expect(theme.intensity).toBeGreaterThanOrEqual(0);
      expect(theme.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('gives dense lyrics tighter leading than sparse ones', () => {
    const dense = buildTheme({ lyrics: synced([[0, 1000, 'a b c d e f g h i j']]), palette: null, energy: 0.5 });
    const sparse = buildTheme({ lyrics: synced([[0, 10_000, 'a b']]), palette: null, energy: 0.5 });
    expect(dense.leading).toBeLessThan(sparse.leading);
  });

  it('still produces a usable theme when there are no lyrics at all', () => {
    const theme = buildTheme({ lyrics: null, palette: null, energy: 0.3 });
    expect(theme.family).toBeTruthy();
    expect(theme.leading).toBeGreaterThan(0);
  });
});

describe('the full family set', () => {
  it('offers a distinct family for each corner of trait space', () => {
    const picks = new Set([
      chooseFamily({ energy: 0.05, density: 0.05 }).id, // still, sparse
      chooseFamily({ energy: 1, density: 1 }).id, // driving, wordy
      chooseFamily({ energy: 0.6, density: 1 }).id, // rapid delivery
      chooseFamily({ energy: 1, density: 0.4 }).id, // forceful, few words
    ]);
    expect(picks.size).toBeGreaterThanOrEqual(3);
  });

  it('gives every family a usable descriptor', () => {
    for (const family of FAMILIES) {
      expect(family.typeface).toContain(',');
      expect(family.weightRange[0]).toBeLessThan(family.weightRange[1]);
      expect(family.leading).toBeGreaterThan(0.8);
      expect(family.intensity).toBeGreaterThan(0);
      expect(family.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('gives every family a unique id, so CSS classes cannot collide', () => {
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
  });

  it('chooses a sparse ambient family for near-wordless tracks', () => {
    expect(chooseFamily({ energy: 0.4, density: 0 }).id).toBe('drift');
  });
});

describe('pinned dimensions', () => {
  const lyrics = synced([[0, 2000, 'soft light and love'], [2000, 4000, 'quiet dream']]);
  const build = (pins: Partial<import('../src/theme/engine.js').ThemePins>) =>
    buildTheme({
      lyrics,
      palette: null,
      energy: 0.2,
      pins: { scheme: null, family: null, backdrop: 'auto', layout: 'centred', ...pins },
    });

  it('honours a pinned family without disturbing the other dimensions', () => {
    const theme = build({ family: 'fracture' });
    expect(theme.family).toBe('fracture');
    expect(theme.scheme).toBe('artwork');
    expect(theme.layout).toBe('centred');
  });

  it('honours a pinned scheme without changing the typography', () => {
    const auto = build({});
    const pinned = build({ scheme: 'paper' });
    expect(pinned.scheme).toBe('paper');
    expect(pinned.light).toBe(true);
    expect(pinned.family).toBe(auto.family);
  });

  it('follows the family default backdrop when backdrop is auto', () => {
    expect(build({ family: 'pulse' }).backdrop).toBe('rings');
    expect(build({ family: 'drift' }).backdrop).toBe('flow');
  });

  it('honours a pinned backdrop over the family default', () => {
    expect(build({ family: 'pulse', backdrop: 'scan' }).backdrop).toBe('scan');
  });

  it('can turn the backdrop off entirely', () => {
    expect(build({ backdrop: 'none' }).backdrop).toBe('none');
  });

  it('honours a pinned layout', () => {
    expect(build({ layout: 'band' }).layout).toBe('band');
  });

  it('reports light false for every scheme but paper', () => {
    for (const scheme of ['artwork', 'midnight', 'neon', 'mono'] as const) {
      expect(build({ scheme }).light).toBe(false);
    }
  });
});
