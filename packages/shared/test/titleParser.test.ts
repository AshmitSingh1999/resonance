import { describe, it, expect } from 'vitest';
import {
  parseBrowserTitle,
  normalizeForMatch,
  trackIdOf,
  cacheKeyOf,
} from '../src/titleParser.js';

/** Convenience: the top-ranked candidate. */
const top = (raw: string) => parseBrowserTitle(raw)[0];

describe('parseBrowserTitle', () => {
  it('splits "Artist - Title" into the obvious candidate first', () => {
    expect(top('Swedish House Mafia - Lioness')).toEqual({
      artist: 'Swedish House Mafia',
      title: 'Lioness',
    });
  });

  it('strips parenthesised production noise', () => {
    expect(top('Adele - Hello (Official Music Video)')).toEqual({
      artist: 'Adele',
      title: 'Hello',
    });
  });

  it('strips bracketed quality tags', () => {
    expect(top('Daft Punk - Around The World [HD] [4K Remaster]')).toEqual({
      artist: 'Daft Punk',
      title: 'Around The World',
    });
  });

  it('strips a trailing " - YouTube" suffix from the window title', () => {
    expect(top('Adele - Hello - YouTube')).toEqual({ artist: 'Adele', title: 'Hello' });
  });

  it('strips a trailing pipe-delimited channel or label', () => {
    expect(top('Arctic Monkeys - 505 | Domino Records')).toEqual({
      artist: 'Arctic Monkeys',
      title: '505',
    });
  });

  it('handles en dash and em dash separators', () => {
    expect(top('Radiohead – Creep')).toEqual({ artist: 'Radiohead', title: 'Creep' });
    expect(top('Radiohead — Creep')).toEqual({ artist: 'Radiohead', title: 'Creep' });
  });

  it('also offers the reversed reading as a lower-ranked candidate', () => {
    // "Lioness - Swedish House Mafia" is equally plausible a priori, so the
    // resolver must be able to try both against the lyrics database.
    const candidates = parseBrowserTitle('Swedish House Mafia - Lioness');
    expect(candidates).toContainEqual({ artist: 'Lioness', title: 'Swedish House Mafia' });
  });

  it('parses the "Title by Artist" form', () => {
    expect(top('Hello by Adele')).toEqual({ artist: 'Adele', title: 'Hello' });
  });

  it('keeps a feat. credit attached to the title, not the artist', () => {
    expect(top('Calvin Harris - Summer (feat. Example)')).toEqual({
      artist: 'Calvin Harris',
      title: 'Summer',
    });
  });

  it('splits on the first separator only, so titles may contain dashes', () => {
    expect(top('Artist - Song - Part Two')).toEqual({
      artist: 'Artist',
      title: 'Song - Part Two',
    });
  });

  it('falls back to a title-only candidate when there is no separator', () => {
    expect(parseBrowserTitle('Bohemian Rhapsody')).toEqual([
      { artist: null, title: 'Bohemian Rhapsody' },
    ]);
  });

  it('returns no candidates for empty or noise-only input', () => {
    expect(parseBrowserTitle('')).toEqual([]);
    expect(parseBrowserTitle('(Official Video)')).toEqual([]);
  });

  it('collapses runs of whitespace left behind by stripping', () => {
    expect(top('Adele  -  Hello   (Live)  ')).toEqual({ artist: 'Adele', title: 'Hello' });
  });

  it('does not emit duplicate candidates', () => {
    const c = parseBrowserTitle('X - X');
    expect(c).toHaveLength(1);
  });
});

describe('normalizeForMatch', () => {
  it('lowercases, strips punctuation and collapses space', () => {
    expect(normalizeForMatch('  Don’t  Stop  Me,  Now! ')).toBe('dont stop me now');
  });

  it('folds accents so lookups survive diacritic differences', () => {
    expect(normalizeForMatch('Béyoncé')).toBe('beyonce');
  });
});

describe('cacheKeyOf', () => {
  it('is stable across casing and punctuation', () => {
    expect(cacheKeyOf({ artist: 'Adele', title: 'Hello!' })).toBe(
      cacheKeyOf({ artist: 'adele', title: 'hello' }),
    );
  });

  it('excludes duration, so millisecond differences cannot fragment the cache', () => {
    // Regression guard: duration is continuous, so bucketing it into an equality
    // key always has a boundary two near-identical reports can straddle.
    expect(cacheKeyOf({ artist: 'A', title: 'B' })).not.toMatch(/\d{3,}/);
  });
});

describe('trackIdOf', () => {
  it('is stable across casing and punctuation', () => {
    const a = trackIdOf({ artist: 'Adele', title: 'Hello!', durationMs: 295_400 });
    const b = trackIdOf({ artist: 'adele', title: 'hello', durationMs: 295_400 });
    expect(a).toBe(b);
  });

  it('distinguishes two recordings of the same song by length', () => {
    const a = trackIdOf({ artist: 'A', title: 'B', durationMs: 180_000 });
    const b = trackIdOf({ artist: 'A', title: 'B', durationMs: 240_000 });
    expect(a).not.toBe(b);
  });

  it('tolerates a null duration', () => {
    expect(trackIdOf({ artist: 'A', title: 'B', durationMs: null })).toContain('a|b');
  });
});
