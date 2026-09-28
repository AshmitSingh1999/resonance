import { describe, it, expect } from 'vitest';
import { LyricsCache } from '../src/lyrics/cache.js';
import type { Lyrics } from '@resonance/shared';

const synced: Lyrics = {
  kind: 'synced',
  lines: [{ startMs: 0, endMs: 1000, text: 'hello' }],
  sourceId: 'lrclib:1',
};
const miss: Lyrics = { kind: 'none', lines: [], sourceId: null };

describe('LyricsCache', () => {
  it('round-trips a hit', () => {
    const cache = new LyricsCache(':memory:');
    cache.set('k', synced, 1000);
    expect(cache.get('k', 1000)).toEqual(synced);
    cache.close();
  });

  it('returns null for an unknown key', () => {
    const cache = new LyricsCache(':memory:');
    expect(cache.get('nope', 1000)).toBeNull();
    cache.close();
  });

  it('caches misses, so a fruitless lookup is not repeated on every play', () => {
    const cache = new LyricsCache(':memory:');
    cache.set('k', miss, null);
    expect(cache.get('k', null)).toEqual(miss);
    cache.close();
  });

  it('expires a cached miss so later uploads are eventually found', () => {
    const cache = new LyricsCache(':memory:', -1); // everything is already stale
    cache.set('k', miss, null);
    expect(cache.get('k', null)).toBeNull();
    cache.close();
  });

  it('does not expire a cached hit', () => {
    const cache = new LyricsCache(':memory:', -1);
    cache.set('k', synced, 1000);
    expect(cache.get('k', 1000)).toEqual(synced);
    cache.close();
  });

  it('matches a cached entry whose duration differs slightly, as sources do', () => {
    const cache = new LyricsCache(':memory:');
    cache.set('k', synced, 193_279);
    expect(cache.get('k', 193_000)).toEqual(synced);
    cache.close();
  });

  it('keeps two recordings of one song apart by length', () => {
    // A radio edit and an extended mix share a name but not their lyrics timing.
    const cache = new LyricsCache(':memory:');
    const extended: Lyrics = { ...synced, sourceId: 'lrclib:2' };
    cache.set('k', synced, 180_000);
    cache.set('k', extended, 360_000);
    expect(cache.get('k', 181_000)!.sourceId).toBe('lrclib:1');
    expect(cache.get('k', 359_000)!.sourceId).toBe('lrclib:2');
    cache.close();
  });

  it('reports a miss when no cached recording is close enough in length', () => {
    const cache = new LyricsCache(':memory:');
    cache.set('k', synced, 180_000);
    expect(cache.get('k', 400_000)).toBeNull();
    cache.close();
  });

  it('overwrites an existing entry rather than failing on the key', () => {
    const cache = new LyricsCache(':memory:');
    cache.set('k', miss, 1000);
    cache.set('k', synced, 1000);
    expect(cache.get('k', 1000)!.kind).toBe('synced');
    cache.close();
  });
});
