import { describe, it, expect } from 'vitest';
import { activeLineIndex, viewAt, wordProgress } from '../src/sync/scheduler.js';
import type { Lyrics, LyricLine } from '@resonance/shared';

const line = (startMs: number, endMs: number, text: string): LyricLine => ({ startMs, endMs, text });

const lyrics: Lyrics = {
  kind: 'synced',
  sourceId: 'test',
  lines: [line(1000, 3000, 'first'), line(3000, 5000, ''), line(5000, 7000, 'third')],
};

describe('activeLineIndex', () => {
  it('returns -1 before the first line starts', () => {
    expect(activeLineIndex(lyrics.lines, 0)).toBe(-1);
  });

  it('finds the line whose window contains the position', () => {
    expect(activeLineIndex(lyrics.lines, 2000)).toBe(0);
    expect(activeLineIndex(lyrics.lines, 6000)).toBe(2);
  });

  it('treats a line as active exactly at its start', () => {
    expect(activeLineIndex(lyrics.lines, 3000)).toBe(1);
  });

  it('holds the last line after it ends', () => {
    expect(activeLineIndex(lyrics.lines, 999_999)).toBe(2);
  });

  it('handles an empty lyric set', () => {
    expect(activeLineIndex([], 1000)).toBe(-1);
  });

  it('agrees with a linear scan across many lines', () => {
    const many = Array.from({ length: 500 }, (_, i) => line(i * 100, i * 100 + 100, `l${i}`));
    for (const probe of [0, 55, 12_345, 49_999, 60_000]) {
      const linear = many.reduce((best, l, i) => (l.startMs <= probe ? i : best), -1);
      expect(activeLineIndex(many, probe)).toBe(linear);
    }
  });
});

describe('viewAt', () => {
  it('reports progress through the active line', () => {
    expect(viewAt(lyrics, 2000).progress).toBeCloseTo(0.5);
  });

  it('flags a timed blank line as instrumental', () => {
    expect(viewAt(lyrics, 4000)).toMatchObject({ index: 1, instrumental: true });
  });

  it('returns nothing for plain lyrics, which have no timings to follow', () => {
    const plain: Lyrics = { kind: 'plain', sourceId: null, lines: [line(0, 0, 'x')] };
    expect(viewAt(plain, 1000).index).toBe(-1);
  });

  it('returns nothing when there are no lyrics at all', () => {
    expect(viewAt(null, 1000).index).toBe(-1);
  });

  it('does not divide by an infinite span on an unbounded final line', () => {
    const open: Lyrics = {
      kind: 'synced',
      sourceId: null,
      lines: [line(0, Number.POSITIVE_INFINITY, 'only')],
    };
    expect(viewAt(open, 5000).progress).toBe(0);
  });
});

describe('wordProgress', () => {
  it('sweeps across words in proportion to their length', () => {
    const p = wordProgress(line(0, 1000, 'aa bbbb'), 0.5);
    // "aa" is a third of the characters, so at the halfway point it is complete
    // and the longer second word has only started.
    expect(p[0]).toBe(1);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[1]).toBeLessThan(1);
  });

  it('reports every word complete at the end of the line', () => {
    expect(wordProgress(line(0, 1000, 'one two three'), 1)).toEqual([1, 1, 1]);
  });

  it('reports nothing started at the beginning of the line', () => {
    expect(wordProgress(line(0, 1000, 'one two'), 0)).toEqual([0, 0]);
  });

  it('returns an empty list for a blank line', () => {
    expect(wordProgress(line(0, 1000, '   '), 0.5)).toEqual([]);
  });

  it('collapses runs of whitespace rather than emitting empty words', () => {
    expect(wordProgress(line(0, 1000, 'a    b'), 1)).toHaveLength(2);
  });
});
