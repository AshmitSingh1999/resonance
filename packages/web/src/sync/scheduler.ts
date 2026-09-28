import type { LyricLine, Lyrics } from '@resonance/shared';

export interface ActiveLyricView {
  /** Index of the line whose window contains the position, or -1 before the first. */
  index: number;
  /** Progress through the active line, 0..1. Zero when there is no active line. */
  progress: number;
  /** True when the active line is a timed gap rather than words. */
  instrumental: boolean;
}

/**
 * Find the active line by binary search.
 *
 * Called every frame against songs with hundreds of lines, so it avoids a linear
 * scan; lines are sorted by start time, which the LRC parser guarantees.
 */
export function activeLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.startMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** What the renderer needs to draw at this instant. */
export function viewAt(lyrics: Lyrics | null, positionMs: number): ActiveLyricView {
  const none: ActiveLyricView = { index: -1, progress: 0, instrumental: false };
  if (lyrics === null || lyrics.kind !== 'synced' || lyrics.lines.length === 0) return none;

  const index = activeLineIndex(lyrics.lines, positionMs);
  if (index < 0) return none;

  const line = lyrics.lines[index]!;
  const span = line.endMs - line.startMs;
  // A final line with an unknown end has no meaningful progress; treat it as just
  // begun rather than dividing by infinity.
  const progress =
    Number.isFinite(span) && span > 0
      ? Math.min(1, Math.max(0, (positionMs - line.startMs) / span))
      : 0;

  return { index, progress, instrumental: line.text.trim() === '' };
}

/**
 * How far through the active word the position is, 0..1 per word.
 *
 * LRCLIB timings are per line, so word timing is interpolated across the line's
 * window in proportion to word length. It is an approximation, but it tracks the
 * sung line closely enough to guide the eye, which is what it is for.
 */
export function wordProgress(line: LyricLine, progress: number): number[] {
  const words = line.text.split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];

  const total = words.reduce((sum, word) => sum + word.length, 0);
  const result: number[] = [];
  let consumed = 0;
  for (const word of words) {
    const start = consumed / total;
    const end = (consumed + word.length) / total;
    consumed += word.length;
    const span = end - start;
    result.push(span <= 0 ? 0 : Math.min(1, Math.max(0, (progress - start) / span)));
  }
  return result;
}
