import { normalizeForMatch } from '@resonance/shared';

/** A song result from the iTunes Search API, as far as we rely on it. */
export interface PreviewCandidate {
  trackName: string;
  artistName: string;
  /** Length of the full track, not of the preview. */
  trackTimeMillis: number | null;
  /** 30-second AAC excerpt. Absent for some catalogue entries. */
  previewUrl: string | null;
}

export interface WantedPreview {
  artist: string;
  title: string;
  durationMs: number | null;
}

/** Closeness of two durations, decaying smoothly rather than cutting off. */
function durationCloseness(candidateMs: number | null, wantedMs: number | null): number {
  if (candidateMs === null || wantedMs === null) return 0.5;
  const differenceSeconds = Math.abs(candidateMs - wantedMs) / 1000;
  return 1 / (1 + differenceSeconds / 10);
}

function nameSimilarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  if (left === '' || right === '') return 0.5;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;
  const leftWords = new Set(left.split(' '));
  const rightWords = right.split(' ');
  const shared = rightWords.filter((word) => leftWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.length);
}

/**
 * Score a candidate against the track that is playing.
 *
 * Ranks rather than filters, for the same reason the lyrics resolver does: the
 * catalogue holds remasters, live versions and edits of differing length, and a
 * hard tolerance would reject every one of them and leave nothing to use.
 */
export function scorePreview(candidate: PreviewCandidate, wanted: WantedPreview): number {
  // A result with no preview is useless here however well it matches.
  if (candidate.previewUrl === null) return 0;

  return (
    nameSimilarity(candidate.trackName, wanted.title) * 0.4 +
    nameSimilarity(candidate.artistName, wanted.artist) * 0.25 +
    durationCloseness(candidate.trackTimeMillis, wanted.durationMs) * 0.35
  );
}

/** The best usable candidate, or null when none carries a preview. */
export function pickBestPreview(
  candidates: readonly PreviewCandidate[],
  wanted: WantedPreview,
): PreviewCandidate | null {
  let best: PreviewCandidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scorePreview(candidate, wanted);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Normalise the raw search payload, discarding entries we cannot use. */
export function toCandidates(body: unknown): PreviewCandidate[] {
  if (body === null || typeof body !== 'object') return [];
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      trackName: typeof row['trackName'] === 'string' ? row['trackName'] : '',
      artistName: typeof row['artistName'] === 'string' ? row['artistName'] : '',
      trackTimeMillis:
        typeof row['trackTimeMillis'] === 'number' ? row['trackTimeMillis'] : null,
      previewUrl: typeof row['previewUrl'] === 'string' ? row['previewUrl'] : null,
    };
  });
}

const SEARCH_URL = 'https://itunes.apple.com/search';

/**
 * Find a 30-second preview for a track.
 *
 * Used to characterise a song's energy when no live audio is running — not for
 * reactivity, which a 30-second excerpt cannot drive. Returns null rather than
 * throwing: a missing preview is an ordinary outcome, and the theme has a
 * perfectly good fallback without it.
 */
export async function findPreviewUrl(wanted: WantedPreview): Promise<string | null> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('term', `${wanted.artist} ${wanted.title}`.trim());
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '12');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return null;
    const best = pickBestPreview(toCandidates(await response.json()), wanted);
    return best?.previewUrl ?? null;
  } catch {
    return null;
  }
}
