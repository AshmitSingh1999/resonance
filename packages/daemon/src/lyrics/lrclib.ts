import type { LrclibRecord } from './ranking.js';

const BASE_URL = 'https://lrclib.net/api';

/**
 * LRCLIB asks clients to identify themselves in place of requiring an API key.
 * Honouring that is the price of a free service with no registration.
 */
const USER_AGENT = 'Resonance/0.1.0 (https://github.com/ashmitsingh/resonance)';

export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`LRCLIB rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitedError';
  }
}

function toRecord(raw: Record<string, unknown>): LrclibRecord | null {
  if (typeof raw['id'] !== 'number' || typeof raw['trackName'] !== 'string') return null;
  return {
    id: raw['id'],
    trackName: raw['trackName'],
    artistName: typeof raw['artistName'] === 'string' ? raw['artistName'] : '',
    albumName: typeof raw['albumName'] === 'string' ? raw['albumName'] : null,
    duration: typeof raw['duration'] === 'number' ? raw['duration'] : null,
    instrumental: raw['instrumental'] === true,
    plainLyrics: typeof raw['plainLyrics'] === 'string' ? raw['plainLyrics'] : null,
    syncedLyrics: typeof raw['syncedLyrics'] === 'string' ? raw['syncedLyrics'] : null,
  };
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '5');
    throw new RateLimitedError((Number.isFinite(retryAfter) ? retryAfter : 5) * 1000);
  }
  // A 404 is the ordinary "no such track" answer, not a failure.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`LRCLIB ${path} returned ${response.status}`);

  return response.json();
}

/**
 * Look up a track by its exact signature.
 *
 * This is the precise path and worth trying first: it matched a remix directly —
 * `Lioness - Francis Mercier Remix` at 193s — where a search on the base title
 * only surfaced unrelated 156s and 173s uploads.
 */
export async function getExact(input: {
  artist: string;
  title: string;
  album?: string | null;
  durationMs?: number | null;
}): Promise<LrclibRecord | null> {
  const body = await request('/get', {
    artist_name: input.artist,
    track_name: input.title,
    album_name: input.album ?? '',
    duration:
      input.durationMs === null || input.durationMs === undefined
        ? ''
        : String(Math.round(input.durationMs / 1000)),
  });
  if (body === null || typeof body !== 'object') return null;
  return toRecord(body as Record<string, unknown>);
}

/** Broad search, used when the exact signature misses. Results need ranking. */
export async function search(input: {
  artist: string | null;
  title: string;
}): Promise<LrclibRecord[]> {
  const body = await request('/search', {
    track_name: input.title,
    artist_name: input.artist ?? '',
  });
  if (!Array.isArray(body)) return [];
  return body
    .map((entry) => toRecord(entry as Record<string, unknown>))
    .filter((entry): entry is LrclibRecord => entry !== null);
}
