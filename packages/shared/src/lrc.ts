import type { LyricLine } from './types.js';

export interface LrcDocument {
  lines: LyricLine[];
  /** Metadata tags such as `ar`, `ti`, `al`, `offset`, lowercased keys. */
  meta: Record<string, string>;
}

export interface ParseLrcOptions {
  /** Track length, used to close the final line's window. */
  durationMs?: number;
}

/** `[mm:ss.xx]` or `[mm:ss.xxx]`, possibly repeated at the head of a line. */
const TIMESTAMP = /\[(\d{1,4}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
/** `[key:value]` where key is alphabetic — a metadata tag rather than a time. */
const META_TAG = /^\[([a-zA-Z]+):(.*)\]$/;

/**
 * Convert an LRC fraction to milliseconds.
 *
 * LRC writes hundredths by convention, so a 2-digit fraction means centiseconds
 * (`.05` is 50ms, not 5ms). A 3-digit fraction is already milliseconds.
 */
function fractionToMs(fraction: string | undefined): number {
  if (!fraction) return 0;
  return fraction.length >= 3
    ? Number(fraction.slice(0, 3))
    : Number(fraction.padEnd(2, '0')) * 10;
}

/**
 * Parse an LRC document into time-ordered lyric lines.
 *
 * Pure and total: malformed input yields fewer lines, never a throw. Each line's
 * `endMs` is the following line's `startMs`, so the renderer can compute progress
 * through the active line without looking ahead.
 */
export function parseLrc(source: string, options: ParseLrcOptions = {}): LrcDocument {
  const meta: Record<string, string> = {};
  const parsed: { startMs: number; text: string }[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const metaMatch = META_TAG.exec(line);
    if (metaMatch) {
      // A metadata tag is alphabetic-keyed; `[00:01.00]` never matches here.
      meta[metaMatch[1]!.toLowerCase()] = metaMatch[2]!.trim();
      continue;
    }

    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let consumedTo = 0;
    while ((match = TIMESTAMP.exec(line)) !== null) {
      // Only leading timestamps count; a `[...]` inside the text is lyric content.
      if (match.index !== consumedTo) break;
      consumedTo = match.index + match[0].length;
      stamps.push(
        Number(match[1]) * 60_000 + Number(match[2]) * 1_000 + fractionToMs(match[3]),
      );
    }
    if (stamps.length === 0) continue;

    const text = line.slice(consumedTo).trim();
    for (const startMs of stamps) parsed.push({ startMs, text });
  }

  // `offset` shifts every timestamp; the tag is only known after a full pass.
  const offsetMs = Number(meta['offset'] ?? 0);
  const shift = Number.isFinite(offsetMs) ? offsetMs : 0;

  parsed.sort((a, b) => a.startMs - b.startMs);

  const lines: LyricLine[] = parsed.map(({ startMs, text }) => ({
    startMs: Math.max(0, startMs + shift),
    endMs: Number.POSITIVE_INFINITY,
    text,
  }));

  // Close each window against the next line, and the last against track end.
  for (let i = 0; i < lines.length - 1; i += 1) {
    lines[i]!.endMs = lines[i + 1]!.startMs;
  }
  const last = lines[lines.length - 1];
  if (last && options.durationMs !== undefined) last.endMs = options.durationMs;

  return { lines, meta };
}
