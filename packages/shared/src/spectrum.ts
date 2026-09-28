/**
 * Shaping raw FFT output into something a visualizer can draw.
 *
 * Shared deliberately: the native helper and the in-page analyser both produce
 * spectra, the listener can switch between them in settings, and the picture must
 * not visibly change when they do. The Swift helper mirrors `aggregateLogBands`
 * exactly; this file is the reference and the tested one.
 */

/** Bars in the spectrum display. */
export const BAND_COUNT = 64;

/** Points in the waveform trace. */
export const WAVEFORM_POINTS = 128;

/** Silence in a byte-encoded time-domain signal. */
export const WAVEFORM_CENTRE = 128;

/** Range the bands span. Below and above this there is nothing musical to show. */
const LOW_HZ = 30;
const HIGH_HZ = 16_000;

/**
 * Collapse FFT bins into log-spaced bands.
 *
 * Log spacing matters more than it might appear. Musical energy is concentrated
 * at the low end, so linear bins put almost everything in the leftmost few bars
 * and leave the rest of the display nearly motionless — which is the usual reason
 * a spectrum display looks broken rather than merely plain. Spacing the bands by
 * octave instead gives every bar something to do.
 *
 * Bands narrower than one FFT bin simply reuse that bin, which is expected at the
 * low end and looks correct.
 */
export function aggregateLogBands(
  magnitudes: Uint8Array,
  sampleRate: number,
  fftSize: number,
): Uint8Array {
  const bands = new Uint8Array(BAND_COUNT);
  if (magnitudes.length === 0) return bands;

  const binWidth = sampleRate / fftSize;
  const ratio = HIGH_HZ / LOW_HZ;

  for (let band = 0; band < BAND_COUNT; band += 1) {
    const fromHz = LOW_HZ * ratio ** (band / BAND_COUNT);
    const toHz = LOW_HZ * ratio ** ((band + 1) / BAND_COUNT);

    let first = Math.floor(fromHz / binWidth);
    let last = Math.ceil(toHz / binWidth) - 1;
    // Always at least one bin, or narrow low bands would read as silent.
    if (last < first) last = first;
    first = Math.min(first, magnitudes.length - 1);
    last = Math.min(last, magnitudes.length - 1);

    let peak = 0;
    for (let i = first; i <= last; i += 1) {
      const value = magnitudes[i] ?? 0;
      if (value > peak) peak = value;
    }
    // Peak rather than mean: a mean over a wide high band washes out transients,
    // and bars that do not answer a cymbal look disconnected from the music.
    bands[band] = peak;
  }

  return bands;
}

/**
 * Reduce a time-domain buffer to a fixed number of points, tracing its envelope.
 *
 * Slices alternate between their maximum and their minimum — the standard way a
 * dense waveform is drawn at low resolution, and the reason a scope shows a solid
 * band rather than a thin line when the music is loud.
 *
 * The two obvious alternatives are both wrong here. Averaging collapses a fast
 * signal toward the centre, so the trace goes flat exactly when the music is
 * busiest. Taking the single most extreme sample looks symmetric but is not: the
 * byte range 0..255 centres on 128, so a negative peak is always fractionally
 * further from centre than the matching positive one, and every slice resolves
 * downward — a trace visibly pinned to one side.
 */
export function downsampleWaveform(samples: Uint8Array): Uint8Array {
  const points = new Uint8Array(WAVEFORM_POINTS).fill(WAVEFORM_CENTRE);
  if (samples.length === 0) return points;

  const step = samples.length / WAVEFORM_POINTS;
  for (let i = 0; i < WAVEFORM_POINTS; i += 1) {
    const first = Math.min(samples.length - 1, Math.floor(i * step));
    const last = Math.min(samples.length - 1, Math.max(first, Math.floor((i + 1) * step) - 1));

    let highest = 0;
    let lowest = 255;
    for (let j = first; j <= last; j += 1) {
      const value = samples[j] ?? WAVEFORM_CENTRE;
      if (value > highest) highest = value;
      if (value < lowest) lowest = value;
    }
    points[i] = i % 2 === 0 ? highest : lowest;
  }

  return points;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 without depending on the environment.
 *
 * Node has `Buffer` and browsers have `atob`, and this runs in both. Hand-rolling
 * it keeps one implementation that is actually exercised by the tests, rather
 * than a branch where only one side is ever covered.
 */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return out;
}

/** Decode base64 to bytes. Malformed input yields an empty array, never a throw. */
export function decodeBase64Bytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/=+$/, '');
  if (clean === '') return new Uint8Array(0);

  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of clean) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) return new Uint8Array(0);
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}
