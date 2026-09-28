import type { PlaybackState } from '@resonance/shared';

/**
 * A correction larger than this is a seek, not drift, and is applied instantly.
 * Easing across it would leave the lyrics wrong for seconds.
 */
export const JUMP_THRESHOLD_MS = 1_500;

/**
 * The most the clock will deviate from real time while correcting, as a fraction
 * of the playback rate.
 *
 * Bounding the *rate* rather than fixing a slew *duration* is what guarantees the
 * clock never runs backwards: at 0.5 the corrected rate stays within 0.5x-1.5x,
 * so time always moves forward and lyrics never jump back a line. A fixed window
 * cannot promise that — a 500ms correction squeezed into 300ms would reverse.
 */
export const MAX_SLEW_RATE = 0.5;

interface Baseline {
  positionMs: number;
  atMs: number;
  rate: number;
}

/**
 * Tracks where we are in the song between position samples.
 *
 * Samples arrive every few seconds; the display needs a position every frame. So
 * the clock extrapolates locally and disciplines itself whenever a sample
 * disagrees — easing into small corrections the way NTP slews, and jumping only
 * for a genuine seek.
 */
export class SyncClock {
  /** User-tuned latency offset, positive when audio lags the reported position. */
  offsetMs = 0;

  #baseline: Baseline | null = null;
  #pendingCorrectionMs = 0;
  #slewStartMs = 0;
  #slewDurationMs = 0;

  reset(): void {
    this.#baseline = null;
    this.#pendingCorrectionMs = 0;
    this.#slewDurationMs = 0;
  }

  /** Position implied by the baseline alone, before any in-flight correction. */
  #baselinePositionAt(nowMs: number): number {
    if (this.#baseline === null) return 0;
    return this.#baseline.positionMs + (nowMs - this.#baseline.atMs) * this.#baseline.rate;
  }

  /** How much of the pending correction has been absorbed by `nowMs`. */
  #appliedCorrectionAt(nowMs: number): number {
    if (this.#slewDurationMs <= 0) return this.#pendingCorrectionMs;
    const progress = Math.min(1, Math.max(0, (nowMs - this.#slewStartMs) / this.#slewDurationMs));
    return this.#pendingCorrectionMs * progress;
  }

  applySample(state: PlaybackState): void {
    // Fold any in-flight correction into the baseline first, so the comparison
    // below is against what the display is actually showing right now.
    const shownNow = this.#baselinePositionAt(state.sampledAtMs) + this.#appliedCorrectionAt(state.sampledAtMs);

    if (this.#baseline === null) {
      this.#baseline = { positionMs: state.positionMs, atMs: state.sampledAtMs, rate: state.rate };
      this.#pendingCorrectionMs = 0;
      this.#slewDurationMs = 0;
      return;
    }

    const correctionMs = state.positionMs - shownNow;

    if (Math.abs(correctionMs) > JUMP_THRESHOLD_MS) {
      // A seek: adopt the new timeline outright and abandon any slew.
      this.#baseline = { positionMs: state.positionMs, atMs: state.sampledAtMs, rate: state.rate };
      this.#pendingCorrectionMs = 0;
      this.#slewDurationMs = 0;
      return;
    }

    this.#baseline = { positionMs: shownNow, atMs: state.sampledAtMs, rate: state.rate };
    this.#pendingCorrectionMs = correctionMs;
    this.#slewStartMs = state.sampledAtMs;
    // Duration follows from the bounded rate, so larger corrections simply take
    // proportionally longer to absorb.
    this.#slewDurationMs = Math.abs(correctionMs) / MAX_SLEW_RATE;
  }

  /** Where the song is at this instant, including the user's latency offset. */
  positionAt(nowMs: number): number {
    if (this.#baseline === null) return 0;
    const position =
      this.#baselinePositionAt(nowMs) + this.#appliedCorrectionAt(nowMs) + this.offsetMs;
    return Math.max(0, position);
  }
}
