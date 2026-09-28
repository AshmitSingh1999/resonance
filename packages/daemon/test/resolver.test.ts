import { describe, it, expect, vi } from 'vitest';
import { LyricsResolver, recordToLyrics } from '../src/lyrics/resolver.js';
import { LyricsCache } from '../src/lyrics/cache.js';
import { RateLimitedError } from '../src/lyrics/lrclib.js';
import type { LrclibRecord } from '../src/lyrics/ranking.js';
import type { Track } from '@resonance/shared';

const record = (over: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: 1,
  trackName: 'Lioness',
  artistName: 'Swedish House Mafia',
  albumName: 'Lioness',
  duration: 193,
  instrumental: false,
  plainLyrics: 'line one\nline two',
  syncedLyrics: '[00:01.00] line one\n[00:05.00] line two',
  ...over,
});

const track = (over: Partial<Track> = {}): Track => ({
  id: 'swedish house mafia|lioness|193',
  title: 'Lioness',
  artist: 'Swedish House Mafia',
  album: 'Lioness',
  durationMs: 193_000,
  artworkDataUrl: null,
  bundleId: 'com.spotify.client',
  source: 'mediaremote',
  inferred: false,
  ...over,
});

const deps = (over: Partial<{ getExact: unknown; search: unknown }> = {}) => ({
  getExact: vi.fn().mockResolvedValue(null),
  search: vi.fn().mockResolvedValue([]),
  ...over,
}) as never;

describe('recordToLyrics', () => {
  it('prefers synced lyrics and closes the last line at the track end', () => {
    const lyrics = recordToLyrics(record(), 193_000);
    expect(lyrics.kind).toBe('synced');
    expect(lyrics.lines[0]).toMatchObject({ startMs: 1000, endMs: 5000, text: 'line one' });
    expect(lyrics.lines[1]!.endMs).toBe(193_000);
  });

  it('falls back to plain lyrics when there are no timings', () => {
    const lyrics = recordToLyrics(record({ syncedLyrics: null }), 193_000);
    expect(lyrics.kind).toBe('plain');
    expect(lyrics.lines.map((l) => l.text)).toEqual(['line one', 'line two']);
  });

  it('falls back to plain when the synced field is present but unparseable', () => {
    const lyrics = recordToLyrics(record({ syncedLyrics: 'no timestamps here' }), 193_000);
    expect(lyrics.kind).toBe('plain');
  });

  it('reports none when the record carries no words at all', () => {
    expect(recordToLyrics(record({ syncedLyrics: null, plainLyrics: null }), null).kind).toBe('none');
  });

  it('records provenance so a wrong match can be traced', () => {
    expect(recordToLyrics(record({ id: 13_698_321 }), null).sourceId).toBe('lrclib:13698321');
  });
});

describe('LyricsResolver', () => {
  it('returns synced lyrics from an exact signature match', async () => {
    const d = deps({ getExact: vi.fn().mockResolvedValue(record()) });
    const lyrics = await new LyricsResolver(new LyricsCache(':memory:'), d).resolve(track());
    expect(lyrics.kind).toBe('synced');
  });

  it('falls back to search when the exact signature misses', async () => {
    const d = deps({ search: vi.fn().mockResolvedValue([record({ duration: 173 })]) });
    const lyrics = await new LyricsResolver(new LyricsCache(':memory:'), d).resolve(track());
    expect(lyrics.kind).toBe('synced');
    expect(d.search).toHaveBeenCalled();
  });

  it('returns none, not an error, when nothing matches', async () => {
    const lyrics = await new LyricsResolver(new LyricsCache(':memory:'), deps()).resolve(track());
    expect(lyrics).toEqual({ kind: 'none', lines: [], sourceId: null });
  });

  it('serves the second lookup from cache without touching the network', async () => {
    const d = deps({ getExact: vi.fn().mockResolvedValue(record()) });
    const resolver = new LyricsResolver(new LyricsCache(':memory:'), d);
    await resolver.resolve(track());
    await resolver.resolve(track());
    expect(d.getExact).toHaveBeenCalledTimes(1);
  });

  it('caches a miss, so an unknown track is not re-queried on every play', async () => {
    const d = deps();
    const resolver = new LyricsResolver(new LyricsCache(':memory:'), d);
    await resolver.resolve(track());
    await resolver.resolve(track());
    expect(d.getExact).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rate limit as a miss', async () => {
    // Caching a throttle would blank the lyrics for this track for a week.
    const d = deps({ getExact: vi.fn().mockRejectedValue(new RateLimitedError(1000)) });
    const resolver = new LyricsResolver(new LyricsCache(':memory:'), d);
    await expect(resolver.resolve(track())).rejects.toBeInstanceOf(RateLimitedError);

    const after = deps({ getExact: vi.fn().mockResolvedValue(record()) });
    const retried = await new LyricsResolver(new LyricsCache(':memory:'), after).resolve(track());
    expect(retried.kind).toBe('synced');
  });

  it('survives a network failure by reporting none', async () => {
    const d = deps({ getExact: vi.fn().mockRejectedValue(new Error('offline')) });
    const lyrics = await new LyricsResolver(new LyricsCache(':memory:'), d).resolve(track());
    expect(lyrics.kind).toBe('none');
  });

  it('does not cache a network failure as a miss', async () => {
    // Being unable to ask is not the same as learning there are no lyrics, and
    // caching it would blank this track for the whole miss TTL over a blip.
    const cache = new LyricsCache(':memory:');
    const failing = deps({ getExact: vi.fn().mockRejectedValue(new Error('offline')) });
    await new LyricsResolver(cache, failing).resolve(track());

    const recovered = deps({ getExact: vi.fn().mockResolvedValue(record()) });
    const lyrics = await new LyricsResolver(cache, recovered).resolve(track());
    expect(lyrics.kind).toBe('synced');
  });

  it('does not reuse a cached entry for a recording of a different length', async () => {
    const cache = new LyricsCache(':memory:');
    const found = deps({ getExact: vi.fn().mockResolvedValue(record()) });
    await new LyricsResolver(cache, found).resolve(track({ durationMs: 405_600 }));

    // A 200s recording is a different cut and must trigger its own lookup.
    const second = deps();
    await new LyricsResolver(cache, second).resolve(track({ durationMs: 200_000 }));
    expect(second.getExact).toHaveBeenCalled();
  });

  it('tries several readings of a browser-inferred track', async () => {
    // "A - B" from a page title could be either order; the database decides.
    const d = deps();
    await new LyricsResolver(new LyricsCache(':memory:'), d).resolve(
      track({ artist: 'Adele', title: 'Hello', inferred: true, bundleId: 'com.google.Chrome' }),
    );
    expect(d.getExact.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not try alternate readings for a structured player', async () => {
    const d = deps();
    await new LyricsResolver(new LyricsCache(':memory:'), d).resolve(track());
    expect(d.getExact).toHaveBeenCalledTimes(1);
  });
});
