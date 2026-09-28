import { describe, it, expect } from 'vitest';
import { scoreRecord, pickBestRecord, type LrclibRecord } from '../src/lyrics/ranking.js';

const record = (over: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id: 1,
  trackName: 'Lioness',
  artistName: 'Swedish House Mafia',
  albumName: 'Lioness',
  duration: 193,
  instrumental: false,
  plainLyrics: 'words',
  syncedLyrics: '[00:01.00] words',
  ...over,
});

const want = { artist: 'Swedish House Mafia', title: 'Lioness', durationMs: 193_000 };

describe('scoreRecord', () => {
  it('scores an exact match highest', () => {
    expect(scoreRecord(record(), want)).toBeGreaterThan(0.9);
  });

  it('prefers the closest duration among otherwise identical records', () => {
    // The finding that drove this: a 193s remix must still rank 173s above 156s
    // rather than every candidate being rejected by a hard tolerance.
    const near = scoreRecord(record({ duration: 173 }), want);
    const far = scoreRecord(record({ duration: 156 }), want);
    expect(near).toBeGreaterThan(far);
  });

  it('never rejects a record outright for duration mismatch', () => {
    // Ranking, not filtering: a distant duration still scores above zero so a
    // sole imperfect match is usable rather than discarded.
    expect(scoreRecord(record({ duration: 156 }), want)).toBeGreaterThan(0);
  });

  it('prefers synced lyrics over plain when everything else ties', () => {
    const synced = scoreRecord(record(), want);
    const plain = scoreRecord(record({ syncedLyrics: null }), want);
    expect(synced).toBeGreaterThan(plain);
  });

  it('penalises a different artist', () => {
    expect(scoreRecord(record({ artistName: 'Someone Else' }), want)).toBeLessThan(
      scoreRecord(record(), want),
    );
  });

  it('penalises a different title', () => {
    expect(scoreRecord(record({ trackName: 'Greyhound' }), want)).toBeLessThan(
      scoreRecord(record(), want),
    );
  });

  it('ignores casing and punctuation when comparing names', () => {
    const a = scoreRecord(record({ trackName: 'lioness!' }), want);
    expect(a).toBeCloseTo(scoreRecord(record(), want), 5);
  });

  it('scores an instrumental record low, since there are no words to show', () => {
    expect(scoreRecord(record({ instrumental: true, syncedLyrics: null, plainLyrics: null }), want))
      .toBeLessThan(0.5);
  });

  it('tolerates an unknown reported duration by ignoring the duration term', () => {
    const noDuration = { ...want, durationMs: null };
    expect(scoreRecord(record({ duration: 999 }), noDuration)).toBeGreaterThan(0.5);
  });
});

describe('pickBestRecord', () => {
  it('returns the highest scoring record', () => {
    const best = pickBestRecord(
      [record({ id: 1, duration: 156 }), record({ id: 2, duration: 193 })],
      want,
    );
    expect(best?.id).toBe(2);
  });

  it('returns null for an empty result set', () => {
    expect(pickBestRecord([], want)).toBeNull();
  });

  it('skips records with no usable lyrics at all', () => {
    const best = pickBestRecord(
      [record({ id: 1, syncedLyrics: null, plainLyrics: null }), record({ id: 2, duration: 999 })],
      want,
    );
    expect(best?.id).toBe(2);
  });

  it('returns null when no record has any lyrics', () => {
    expect(pickBestRecord([record({ syncedLyrics: null, plainLyrics: null })], want)).toBeNull();
  });

  it('prefers a wrong-length synced match over a right-length plain one', () => {
    // Timing is what the display needs; a plain match cannot be shown in sync.
    const best = pickBestRecord(
      [
        record({ id: 1, duration: 193, syncedLyrics: null }),
        record({ id: 2, duration: 180 }),
      ],
      want,
    );
    expect(best?.id).toBe(2);
  });
});
