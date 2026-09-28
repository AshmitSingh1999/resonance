import type { Track } from '@resonance/shared';
import { parseBrowserTitle, trackIdOf } from '@resonance/shared';

/** One line of the adapter's NDJSON stream. */
export interface AdapterEnvelope {
  type: string;
  diff: boolean;
  payload: Record<string, unknown>;
}

/** The adapter's now-playing dictionary, as far as we rely on it. */
export type AdapterPayload = Record<string, unknown>;

/**
 * Apply one streamed envelope to the held now-playing state.
 *
 * The adapter streams diffs by default: `diff: false` is a complete snapshot that
 * replaces state wholesale, while `diff: true` carries only changed keys, with an
 * explicit `null` meaning the key has vanished and must be dropped.
 *
 * Kept pure so the merge rules can be tested without spawning a subprocess.
 */
export function mergePayload(
  previous: AdapterPayload,
  envelope: AdapterEnvelope,
): AdapterPayload {
  if (!envelope.diff) return { ...envelope.payload };

  const next: AdapterPayload = { ...previous };
  for (const [key, value] of Object.entries(envelope.payload)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

const BROWSER_BUNDLE_IDS = new Set([
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'com.apple.Safari',
  'company.thebrowser.Browser',
  'com.brave.Browser',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
]);

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Convert an adapter payload into a `Track`, or null when nothing is playing.
 *
 * Browsers report the page title in the `title` field with no separate artist, so
 * those are routed through the title parser and flagged `inferred` — the lyric
 * resolver must then try several readings rather than trusting the fields.
 */
export function toTrack(payload: AdapterPayload): Track | null {
  const rawTitle = str(payload['title']);
  if (rawTitle === null) return null;

  const bundleId = str(payload['bundleIdentifier']);
  const durationSeconds = num(payload['duration']);
  const durationMs = durationSeconds === null ? null : Math.round(durationSeconds * 1000);

  let artist = str(payload['artist']);
  let title = rawTitle;
  let inferred = false;

  // A browser with no artist field means the title is free-form page text.
  if (artist === null && bundleId !== null && BROWSER_BUNDLE_IDS.has(bundleId)) {
    const [best] = parseBrowserTitle(rawTitle);
    if (best) {
      artist = best.artist;
      title = best.title;
      inferred = true;
    }
  }

  const artworkBase64 = str(payload['artworkData']);
  const artworkMime = str(payload['artworkMimeType']) ?? 'image/jpeg';

  return {
    id: trackIdOf({ artist, title, durationMs }),
    title,
    artist: artist ?? '',
    album: str(payload['album']),
    durationMs,
    artworkDataUrl: artworkBase64 === null ? null : `data:${artworkMime};base64,${artworkBase64}`,
    bundleId,
    source: 'mediaremote',
    inferred,
  };
}

/**
 * Read playback position from a payload.
 *
 * `elapsedTime` was true at `timestamp`, not at the moment we parsed the line, so
 * the sample carries its own instant and the consumer extrapolates from there.
 */
export function toPlaybackState(
  payload: AdapterPayload,
  fallbackNowMs: number,
): { playing: boolean; positionMs: number; sampledAtMs: number; rate: number } | null {
  const elapsed = num(payload['elapsedTime']);
  if (elapsed === null) return null;

  const playing = payload['playing'] === true;
  const rate = playing ? (num(payload['playbackRate']) ?? 1) : 0;

  const stamp = str(payload['timestamp']);
  const parsed = stamp === null ? Number.NaN : Date.parse(stamp);
  const sampledAtMs = Number.isNaN(parsed) ? fallbackNowMs : parsed;

  return { playing, positionMs: Math.round(elapsed * 1000), sampledAtMs, rate };
}
