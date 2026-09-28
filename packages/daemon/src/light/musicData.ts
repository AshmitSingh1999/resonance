/**
 * Encoding for Tuya data point 27, `music_data`.
 *
 * This DP exists for exactly this purpose: it applies a colour immediately,
 * where ordinary colour commands run the bulb's slow fade and make anything
 * beat-driven look like mush.
 *
 * The value is a 21-character string — a change-mode digit followed by five
 * 4-digit hex fields. Tuya's documented example `1007603e803e800120025` is
 * gradient, hue 118, saturation 1000, value 1000, brightness 18, temperature 37.
 */

export type MusicChangeMode = 'jump' | 'gradient';

export interface MusicData {
  mode: MusicChangeMode;
  /** 0..360 */
  h: number;
  /** 0..1000 */
  s: number;
  /** 0..1000 */
  v: number;
  /** 0..1000 */
  bright: number;
  /** 0..1000 */
  temp: number;
}

const FIELD_DIGITS = 4;
const ENCODED_LENGTH = 1 + FIELD_DIGITS * 5;

function clampField(value: number, max: number): number {
  // Non-finite input would render as "NaN" and produce a string the bulb
  // rejects without complaint, which reads as the light having died.
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

function hex4(value: number): string {
  return value.toString(16).padStart(FIELD_DIGITS, '0');
}

export function encodeMusicData(data: MusicData): string {
  return (
    (data.mode === 'gradient' ? '1' : '0') +
    hex4(clampField(data.h, 360)) +
    hex4(clampField(data.s, 1000)) +
    hex4(clampField(data.v, 1000)) +
    hex4(clampField(data.bright, 1000)) +
    hex4(clampField(data.temp, 1000))
  );
}

/** Inverse of {@link encodeMusicData}. Returns null for anything malformed. */
export function decodeMusicData(encoded: string): MusicData | null {
  if (encoded.length !== ENCODED_LENGTH) return null;
  if (!/^[01][0-9a-f]{20}$/i.test(encoded)) return null;

  const field = (index: number): number =>
    parseInt(encoded.slice(1 + index * FIELD_DIGITS, 1 + (index + 1) * FIELD_DIGITS), 16);

  return {
    mode: encoded[0] === '1' ? 'gradient' : 'jump',
    h: field(0),
    s: field(1),
    v: field(2),
    bright: field(3),
    temp: field(4),
  };
}
