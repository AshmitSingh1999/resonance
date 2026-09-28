/**
 * Turning a browser window title into something a lyrics database can match.
 *
 * Native players report structured `artist` / `title` fields. Chrome reports the
 * page title, which is free-form marketing text: `"Artist - Song (Official Video)
 * [4K] | Label"`. This module reduces such a string to a short ranked list of
 * plausible `{artist, title}` readings; the resolver then tries each against
 * LRCLIB and lets the database settle which one is real.
 */

export interface TitleCandidate {
  artist: string | null;
  title: string;
}

/** Parenthesised/bracketed segments that are production noise, not song titles. */
const NOISE_SEGMENT =
  /\b(official|lyric[s]?|audio|video|visuali[sz]er|music|mv|hd|hq|4k|8k|remaster(ed)?|full|explicit|clean|live|performance|session|edit|version|color[sz]?)\b/i;

/** Channel/label suffixes appended after a pipe. */
const PIPE_SUFFIX = /\s*\|.*$/;

/** Window-title suffixes added by the browser or site. */
const SITE_SUFFIX = /\s*[-–—]\s*(YouTube|YouTube Music|SoundCloud|Vimeo|Bandcamp)\s*$/i;

const SEPARATORS = /\s+[-–—]\s+/;

/**
 * Remove a bracketed segment when it looks like production noise.
 *
 * A segment is kept when it carries meaning a database would also hold, such as
 * `(Francis Mercier Remix)` or `(Acoustic)`, because dropping it would match the
 * wrong recording.
 */
function stripNoiseSegments(input: string): string {
  return input.replace(/[([{]([^)\]}]*)[)\]}]/g, (whole, inner: string) => {
    if (/\b(remix|mix|acoustic|instrumental|reprise|demo|cover)\b/i.test(inner)) return whole;
    if (/^feat\.?\b|^ft\.?\b|^with\b/i.test(inner.trim())) return '';
    return NOISE_SEGMENT.test(inner) ? '' : whole;
  });
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[\s\-–—,.:]+|[\s\-–—,.:]+$/g, '').trim();
}

function push(into: TitleCandidate[], candidate: TitleCandidate): void {
  if (candidate.title === '') return;
  const exists = into.some(
    (c) => c.artist === candidate.artist && c.title === candidate.title,
  );
  if (!exists) into.push(candidate);
}

/**
 * Produce ranked `{artist, title}` readings of a browser title, best guess first.
 *
 * The reversed reading is always offered because `"A - B"` is genuinely ambiguous;
 * the caller disambiguates by querying the lyrics database and preferring the
 * candidate whose stored duration is closest to the reported one.
 */
export function parseBrowserTitle(raw: string): TitleCandidate[] {
  const cleaned = tidy(stripNoiseSegments(tidy(raw).replace(SITE_SUFFIX, '').replace(PIPE_SUFFIX, '')));
  if (cleaned === '') return [];

  const candidates: TitleCandidate[] = [];

  const byMatch = /^(.+?)\s+by\s+(.+)$/i.exec(cleaned);
  if (byMatch) {
    push(candidates, { artist: tidy(byMatch[2]!), title: tidy(byMatch[1]!) });
  }

  const sep = SEPARATORS.exec(cleaned);
  if (sep) {
    const left = tidy(cleaned.slice(0, sep.index));
    const right = tidy(cleaned.slice(sep.index + sep[0].length));
    if (left !== '' && right !== '') {
      push(candidates, { artist: left, title: right });
      push(candidates, { artist: right, title: left });
    }
  }

  if (candidates.length === 0) push(candidates, { artist: null, title: cleaned });
  return candidates;
}

/**
 * Reduce a string to a comparison key: lowercase, unaccented, punctuation-free.
 *
 * Used for cache keys and for comparing a database hit against what the player
 * reported, where `"Don't"` and `"Don’t"` must be the same thing.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stable identity for "which recording is this", used for cache lookup.
 *
 * Deliberately excludes duration. Duration is a continuous quantity and any
 * bucketing of it has boundaries, so two reports of the same track that differ
 * by milliseconds can land either side of one and fragment the cache. Different
 * recordings of the same song are instead separated at lookup time, by comparing
 * the stored duration against the reported one with a tolerance.
 */
export function cacheKeyOf(input: { artist: string | null; title: string }): string {
  return `${normalizeForMatch(input.artist ?? '')}|${normalizeForMatch(input.title)}`;
}

/**
 * Identity of the currently playing item, used to route messages and to detect
 * track changes.
 *
 * Unlike {@link cacheKeyOf} this does include duration, because within a single
 * player the reported duration is deterministic, and including it means a switch
 * between two recordings of the same song is correctly seen as a track change.
 */
export function trackIdOf(input: {
  artist: string | null;
  title: string;
  durationMs: number | null;
}): string {
  const seconds = input.durationMs === null ? '?' : String(Math.round(input.durationMs / 1000));
  return `${cacheKeyOf(input)}|${seconds}`;
}
