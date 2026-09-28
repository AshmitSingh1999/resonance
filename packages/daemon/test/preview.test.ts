import { describe, it, expect } from 'vitest';
import { pickBestPreview, scorePreview, toCandidates } from '../src/audio/preview.js';
import type { PreviewCandidate } from '../src/audio/preview.js';

const candidate = (over: Partial<PreviewCandidate> = {}): PreviewCandidate => ({
  trackName: 'Lioness',
  artistName: 'Swedish House Mafia',
  trackTimeMillis: 193_000,
  previewUrl: 'https://example.test/a.m4a',
  ...over,
});

const wanted = { artist: 'Swedish House Mafia', title: 'Lioness', durationMs: 193_000 };

describe('scorePreview', () => {
  it('scores an exact match highly', () => {
    expect(scorePreview(candidate(), wanted)).toBeGreaterThan(0.9);
  });

  it('scores a result with no preview as unusable', () => {
    // However well it matches, it cannot be played or decoded.
    expect(scorePreview(candidate({ previewUrl: null }), wanted)).toBe(0);
  });

  it('prefers the closest duration', () => {
    const near = scorePreview(candidate({ trackTimeMillis: 196_000 }), wanted);
    const far = scorePreview(candidate({ trackTimeMillis: 240_000 }), wanted);
    expect(near).toBeGreaterThan(far);
  });

  it('never rejects outright for a duration mismatch', () => {
    expect(scorePreview(candidate({ trackTimeMillis: 400_000 }), wanted)).toBeGreaterThan(0);
  });

  it('penalises a different artist', () => {
    expect(scorePreview(candidate({ artistName: 'Someone Else' }), wanted)).toBeLessThan(
      scorePreview(candidate(), wanted),
    );
  });

  it('tolerates an unknown duration on either side', () => {
    expect(scorePreview(candidate({ trackTimeMillis: null }), wanted)).toBeGreaterThan(0.5);
    expect(scorePreview(candidate(), { ...wanted, durationMs: null })).toBeGreaterThan(0.5);
  });
});

describe('pickBestPreview', () => {
  it('picks the closest match', () => {
    const best = pickBestPreview(
      [candidate({ trackTimeMillis: 300_000, previewUrl: 'a' }), candidate({ previewUrl: 'b' })],
      wanted,
    );
    expect(best?.previewUrl).toBe('b');
  });

  it('skips entries without a preview', () => {
    const best = pickBestPreview(
      [candidate({ previewUrl: null }), candidate({ trackTimeMillis: 260_000, previewUrl: 'c' })],
      wanted,
    );
    expect(best?.previewUrl).toBe('c');
  });

  it('returns null when nothing is usable', () => {
    expect(pickBestPreview([candidate({ previewUrl: null })], wanted)).toBeNull();
    expect(pickBestPreview([], wanted)).toBeNull();
  });
});

describe('toCandidates', () => {
  it('reads the iTunes search payload', () => {
    const rows = toCandidates({
      resultCount: 1,
      results: [{ trackName: 'A', artistName: 'B', trackTimeMillis: 1000, previewUrl: 'u' }],
    });
    expect(rows).toEqual([
      { trackName: 'A', artistName: 'B', trackTimeMillis: 1000, previewUrl: 'u' },
    ]);
  });

  it('marks a missing previewUrl as null rather than dropping the row', () => {
    expect(toCandidates({ results: [{ trackName: 'A' }] })[0]).toMatchObject({
      previewUrl: null,
      trackTimeMillis: null,
    });
  });

  it('returns nothing for a malformed payload', () => {
    expect(toCandidates(null)).toEqual([]);
    expect(toCandidates({})).toEqual([]);
    expect(toCandidates({ results: 'nope' })).toEqual([]);
  });
});
