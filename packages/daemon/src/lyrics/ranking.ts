import { normalizeForMatch } from '@resonance/shared';

/** A lyrics record as LRCLIB returns it. */
export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  /** Track length in seconds. */
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/** What the player told us we are listening to. */
export interface WantedTrack {
  artist: string | null;
  title: string;
  durationMs: number | null;
}

/** Similarity of two names in 0..1, comparing normalized forms. */
function nameSimilarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  if (left === '' || right === '') return 0.5; // unknown, so neither reward nor punish
  if (left === right) return 1;
  // One containing the other covers "Lioness" vs "Lioness - Francis Mercier Remix".
  if (left.includes(right) || right.includes(left)) return 0.8;

  const leftWords = new Set(left.split(' '));
  const rightWords = right.split(' ');
  const shared = rightWords.filter((word) => leftWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.length);
}

/**
 * Closeness of two durations in 0..1, decaying smoothly with the difference.
 *
 * Deliberately a decay rather than a threshold. Searching a base title returns
 * versions minutes apart from the one playing — a 193s remix against 156s and
 * 173s uploads — and a hard tolerance would reject all of them, leaving nothing
 * to show. Ranking keeps the closest while never excluding a sole candidate.
 */
function durationCloseness(recordSeconds: number | null, wantedMs: number | null): number {
  if (recordSeconds === null || wantedMs === null) return 0.5; // no information either way
  const differenceSeconds = Math.abs(recordSeconds - wantedMs / 1000);
  // Half credit at 10s out, tailing off gracefully rather than cutting off.
  return 1 / (1 + differenceSeconds / 10);
}

/** Name and duration agreement, summing to 1. */
const WEIGHTS = { title: 0.4, artist: 0.25, duration: 0.35 } as const;

/**
 * Below this, the record is about a different song rather than a worse match for
 * this one, and promoting it because it happens to carry synced lyrics would put
 * the wrong words on screen.
 */
const PLAUSIBILITY_FLOOR = 0.45;

/**
 * Score how well a record matches what is playing, in 0..1. Zero means unusable.
 *
 * Synced and plain lyrics are ranked as separate tiers rather than separated by a
 * weight. The difference is categorical: the display exists to show words in
 * time, and a plain record cannot do that at all — it falls back to a static
 * reading. So any plausible synced record outranks any plain one, and the match
 * quality only orders records within a tier.
 *
 * Within a tier every term is a smooth preference, never a gate, so a sole
 * imperfect match is still offered instead of an empty screen.
 */
export function scoreRecord(record: LrclibRecord, wanted: WantedTrack): number {
  const hasLyrics = record.syncedLyrics !== null || record.plainLyrics !== null;
  if (!hasLyrics) return 0;

  const quality =
    nameSimilarity(record.trackName, wanted.title) * WEIGHTS.title +
    nameSimilarity(record.artistName, wanted.artist ?? '') * WEIGHTS.artist +
    durationCloseness(record.duration, wanted.durationMs) * WEIGHTS.duration;

  if (quality < PLAUSIBILITY_FLOOR) return 0;

  return quality * 0.5 + (record.syncedLyrics === null ? 0 : 0.5);
}

/** The best usable record, or null when none is both plausible and lyric-bearing. */
export function pickBestRecord(
  records: readonly LrclibRecord[],
  wanted: WantedTrack,
): LrclibRecord | null {
  let best: LrclibRecord | null = null;
  let bestScore = 0;
  for (const record of records) {
    const score = scoreRecord(record, wanted);
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }
  return best;
}
