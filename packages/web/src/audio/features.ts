/**
 * Turning a spectrum into a handful of numbers the renderer can animate against.
 *
 * Everything here is pure and works on a plain frequency array, so the behaviour
 * can be tested without a browser, an audio device, or anything playing.
 */

export interface SpectrumContext {
  sampleRate: number;
  fftSize: number;
}

export interface AudioFeatures {
  /** Band energies, 0..1. */
  bass: number;
  mid: number;
  treble: number;
  /** Overall level, 0..1. */
  rms: number;
  /** Perceptual brightness as a fraction of Nyquist, 0..1. */
  centroid: number;
}

export const SILENCE: AudioFeatures = { bass: 0, mid: 0, treble: 0, rms: 0, centroid: 0 };

/** Bands chosen to match what the ear groups, not to divide the range evenly. */
const BANDS = {
  bass: [20, 250],
  mid: [250, 2_000],
  treble: [2_000, 16_000],
} as const;

/** Index of the FFT bin covering a frequency, clamped to the valid range. */
export function binForFrequency(hz: number, ctx: SpectrumContext): number {
  const bins = ctx.fftSize / 2;
  const binWidth = ctx.sampleRate / ctx.fftSize;
  return Math.min(bins - 1, Math.max(0, Math.round(hz / binWidth)));
}

/** Mean magnitude across a frequency range, normalised to 0..1. */
function bandEnergy(data: Uint8Array, lowHz: number, highHz: number, ctx: SpectrumContext): number {
  const from = binForFrequency(lowHz, ctx);
  const to = binForFrequency(highHz, ctx);
  let total = 0;
  for (let i = from; i <= to; i += 1) total += data[i] ?? 0;
  const count = to - from + 1;
  return count <= 0 ? 0 : total / count / 255;
}

export function analyseSpectrum(data: Uint8Array, ctx: SpectrumContext): AudioFeatures {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 1) {
    const magnitude = data[i]!;
    weighted += i * magnitude;
    total += magnitude;
  }

  return {
    bass: bandEnergy(data, BANDS.bass[0], BANDS.bass[1], ctx),
    mid: bandEnergy(data, BANDS.mid[0], BANDS.mid[1], ctx),
    treble: bandEnergy(data, BANDS.treble[0], BANDS.treble[1], ctx),
    rms: total / data.length / 255,
    // Expressed as a fraction of Nyquist so it is comparable across devices.
    centroid: total === 0 ? 0 : weighted / total / data.length,
  };
}

/** One step of exponential smoothing; `factor` of 1 passes the target through. */
export function smooth(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

/**
 * Detects beats as sudden rises in spectral energy.
 *
 * Uses spectral flux — the sum of per-bin increases since the last frame — which
 * responds to a new sound entering rather than to loudness itself. The threshold
 * is derived from recent history rather than fixed, so a dense loud mix settles
 * instead of reporting every frame as a beat and strobing the visuals.
 */
export class OnsetDetector {
  #previous: Uint8Array | null = null;
  readonly #history: number[] = [];

  constructor(
    /** Frames of flux history the threshold is derived from. */
    private readonly historySize = 43,
    /** How far above the recent mean a frame must rise to count. */
    private readonly sensitivity = 1.6,
    /** Frames to wait after a beat, so one transient is not counted twice. */
    private readonly refractoryFrames = 6,
  ) {}

  #cooldown = 0;

  push(data: Uint8Array): boolean {
    const previous = this.#previous;
    // Copy: the analyser reuses its buffer, so a reference would alias.
    this.#previous = data.slice();

    if (previous === null) return false;

    let flux = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Rectified: only increases count, so a fading note is not an onset.
      const rise = (data[i] ?? 0) - (previous[i] ?? 0);
      if (rise > 0) flux += rise;
    }

    const history = this.#history;
    const mean = history.length === 0 ? 0 : history.reduce((a, b) => a + b, 0) / history.length;

    history.push(flux);
    if (history.length > this.historySize) history.shift();

    if (this.#cooldown > 0) {
      this.#cooldown -= 1;
      return false;
    }

    // Needs enough history to have a meaningful baseline, and enough absolute
    // energy that quantisation noise in near-silence cannot trip it.
    const isOnset = history.length >= 8 && flux > mean * this.sensitivity && flux > data.length * 0.1;
    if (isOnset) this.#cooldown = this.refractoryFrames;
    return isOnset;
  }
}
