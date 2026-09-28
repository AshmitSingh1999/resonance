import type { Lyrics, Track } from '@resonance/shared';
import { cacheKeyOf, parseLrc, parseBrowserTitle } from '@resonance/shared';
import { LyricsCache } from './cache.js';
import { getExact, search, RateLimitedError } from './lrclib.js';
import { pickBestRecord, type LrclibRecord, type WantedTrack } from './ranking.js';

const NO_LYRICS: Lyrics = { kind: 'none', lines: [], sourceId: null };

/** Convert a chosen record into the shape the renderer consumes. */
export function recordToLyrics(record: LrclibRecord, durationMs: number | null): Lyrics {
  if (record.syncedLyrics !== null) {
    const parsed = parseLrc(record.syncedLyrics, durationMs === null ? {} : { durationMs });
    if (parsed.lines.length > 0) {
      return { kind: 'synced', lines: parsed.lines, sourceId: `lrclib:${record.id}` };
    }
  }

  if (record.plainLyrics !== null && record.plainLyrics.trim() !== '') {
    // Untimed: the renderer shows these as a static reading rather than in sync.
    const lines = record.plainLyrics
      .split(/\r?\n/)
      .map((text) => ({ startMs: 0, endMs: 0, text: text.trim() }));
    return { kind: 'plain', lines, sourceId: `lrclib:${record.id}` };
  }

  return NO_LYRICS;
}

export interface ResolveDeps {
  getExact: typeof getExact;
  search: typeof search;
}

/**
 * Finds the words for whatever is playing.
 *
 * Walks a ladder rather than failing: exact signature, then a ranked search, then
 * plain lyrics, then nothing — because a blank screen reads as broken, while a
 * static reading or an ambient visual does not.
 */
export class LyricsResolver {
  constructor(
    private readonly cache: LyricsCache,
    private readonly deps: ResolveDeps = { getExact, search },
  ) {}

  /**
   * Candidate readings of a track, best first.
   *
   * Native players report structured fields and get a single candidate. Browser
   * tracks were parsed out of a page title, so several readings are plausible and
   * the database decides between them.
   */
  #candidatesFor(track: Track): WantedTrack[] {
    if (!track.inferred) {
      return [{ artist: track.artist, title: track.title, durationMs: track.durationMs }];
    }
    const parsed = parseBrowserTitle(`${track.artist} - ${track.title}`);
    const candidates = parsed.map((c) => ({ ...c, durationMs: track.durationMs }));
    return candidates.length > 0
      ? candidates
      : [{ artist: track.artist, title: track.title, durationMs: track.durationMs }];
  }

  async resolve(track: Track): Promise<Lyrics> {
    const key = cacheKeyOf({ artist: track.artist, title: track.title });

    const cached = this.cache.get(key, track.durationMs);
    if (cached !== null) return cached;

    let resolved: Lyrics;
    try {
      resolved = await this.#fetch(track);
    } catch (error) {
      // A rate limit is the caller's to handle and retry.
      if (error instanceof RateLimitedError) throw error;
      // Any other failure — offline, DNS, a timeout — means we did not learn that
      // this track has no lyrics, only that we could not ask. Returning `none`
      // keeps the display graceful, but caching it would blank the track for the
      // whole miss TTL over a momentary blip, so the failure is left uncached.
      return NO_LYRICS;
    }

    this.cache.set(key, resolved, track.durationMs);
    return resolved;
  }

  async #fetch(track: Track): Promise<Lyrics> {
    const candidates = this.#candidatesFor(track);

    // The exact signature is precise enough to match a specific remix, so it is
    // worth trying for every candidate before falling back to a broad search.
    for (const candidate of candidates) {
      if (candidate.artist === null) continue;
      const record = await this.deps.getExact({
        artist: candidate.artist,
        title: candidate.title,
        album: track.album,
        durationMs: candidate.durationMs,
      });
      if (record !== null) {
        const lyrics = recordToLyrics(record, track.durationMs);
        if (lyrics.kind !== 'none') return lyrics;
      }
    }

    // Search returns versions of varying length, so the results are ranked rather
    // than filtered: the closest is chosen, but a distant one still beats nothing.
    for (const candidate of candidates) {
      const results = await this.deps.search({
        artist: candidate.artist,
        title: candidate.title,
      });
      const best = pickBestRecord(results, candidate);
      if (best !== null) {
        const lyrics = recordToLyrics(best, track.durationMs);
        if (lyrics.kind !== 'none') return lyrics;
      }
    }

    return NO_LYRICS;
  }
}
