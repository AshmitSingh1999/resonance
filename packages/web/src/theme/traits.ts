import type { Lyrics } from '@resonance/shared';

/**
 * Words per second across the sung span of a track.
 *
 * A useful proxy for how the words should be set: a ballad with a handful of
 * lines wants large, airy type, while rapid delivery needs smaller, tighter
 * lines or it cannot keep up. Measured over the span from the first line to the
 * last rather than the whole track, so a long instrumental outro does not make a
 * dense song look sparse.
 */
export function lyricDensity(lyrics: Lyrics | null): number {
  if (lyrics === null || lyrics.kind !== 'synced' || lyrics.lines.length === 0) return 0;

  const words = lyrics.lines.reduce(
    (sum, line) => sum + line.text.split(/\s+/).filter((w) => w !== '').length,
    0,
  );
  const first = lyrics.lines[0]!.startMs;
  const lastLine = lyrics.lines[lyrics.lines.length - 1]!;
  const last = Number.isFinite(lastLine.endMs) ? lastLine.endMs : lastLine.startMs;

  const spanSeconds = (last - first) / 1000;
  if (spanSeconds <= 0) return 0;
  return words / spanSeconds;
}

/**
 * A crude warm/bleak reading of lyric text, -1 to 1.
 *
 * Deliberately a small hand-written lexicon rather than a model: it runs in a
 * frame, needs no download, and is only steering colour temperature and contrast.
 * Being roughly right is enough; being wrong is a slightly-off palette, not a
 * broken screen.
 */
const WARM = new Set([
  'love', 'light', 'joy', 'dream', 'sun', 'sunshine', 'smile', 'dance', 'home', 'warm',
  'alive', 'free', 'gold', 'golden', 'beautiful', 'sweet', 'hope', 'together', 'heaven',
  'bright', 'shine', 'happy', 'kiss', 'heart', 'rise', 'fly', 'summer', 'good', 'wonder',
]);

const BLEAK = new Set([
  'hate', 'broken', 'cold', 'alone', 'pain', 'dark', 'lost', 'cry', 'tears', 'die',
  'death', 'empty', 'hurt', 'fear', 'blood', 'grave', 'lonely', 'numb', 'sorrow', 'gone',
  'fall', 'rain', 'ghost', 'scream', 'bitter', 'shadow', 'end', 'never', 'silence', 'war',
]);

export function lyricValence(text: string): number {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return 0;

  let score = 0;
  let matched = 0;
  for (const word of words) {
    if (WARM.has(word)) { score += 1; matched += 1; }
    else if (BLEAK.has(word)) { score -= 1; matched += 1; }
  }
  if (matched === 0) return 0;

  // Scaled by how much of the text actually carried signal, so a single warm word
  // in a long neutral lyric does not read as euphoric.
  const strength = Math.min(1, matched / Math.max(8, words.length * 0.12));
  return Math.max(-1, Math.min(1, (score / matched) * strength));
}
