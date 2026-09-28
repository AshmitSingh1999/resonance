import type { Hsv } from '@resonance/shared';

export interface ThrottleOptions {
  /** Shortest gap between writes to the device. */
  minIntervalMs: number;
  /**
   * How much a colour must change to be worth a network round trip. Measured as
   * the largest single-component difference, hue in degrees and the others on
   * the device's 0..1000 scale.
   */
  epsilon?: number;
}

/** Smallest hue difference, going the short way round the circle. */
function hueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

/**
 * Decides when a colour is actually worth sending to the bulb.
 *
 * A Tuya bulb over Wi-Fi answers in roughly 50–150ms and drops commands when
 * saturated, while audio features arrive at 30Hz. Something has to discard most
 * of them, and *which* ones it discards decides whether the light looks in time.
 *
 * Stale values are dropped rather than queued. A queue would grow under load and
 * the light would fall further behind the music exactly when the music was most
 * active; dropping is safe here because a fresher frame is never more than about
 * 33ms away.
 *
 * Time is passed in rather than read, so the behaviour is pinned by tests instead
 * of being inferred from watching a bulb.
 */
export class ColourThrottle {
  #minIntervalMs: number;
  readonly #epsilon: number;

  #lastSent: Hsv | null = null;
  #lastSentAtMs = Number.NEGATIVE_INFINITY;
  #inFlight = false;

  constructor(options: ThrottleOptions) {
    this.#minIntervalMs = options.minIntervalMs;
    this.#epsilon = options.epsilon ?? 12;
  }

  get lastSent(): Hsv | null {
    return this.#lastSent;
  }

  setMinInterval(ms: number): void {
    this.#minIntervalMs = ms;
  }

  /**
   * Offer a colour. Returns true when the caller should send it now, in which
   * case the caller must later call `complete()` or `fail()`.
   */
  offer(colour: Hsv, nowMs: number): boolean {
    if (this.#inFlight) return false;
    if (nowMs - this.#lastSentAtMs < this.#minIntervalMs) return false;

    const previous = this.#lastSent;
    if (previous !== null) {
      const changed =
        hueDistance(previous.h, colour.h) > this.#epsilon ||
        Math.abs(previous.s - colour.s) > this.#epsilon ||
        Math.abs(previous.v - colour.v) > this.#epsilon;
      if (!changed) return false;
    }

    this.#lastSent = colour;
    this.#lastSentAtMs = nowMs;
    this.#inFlight = true;
    return true;
  }

  /** The write succeeded. */
  complete(): void {
    this.#inFlight = false;
  }

  /** The write failed. Releases the slot so a recovered bulb is not locked out. */
  fail(): void {
    this.#inFlight = false;
  }

  /** Forget the last colour, so the next offer always sends. */
  reset(): void {
    this.#lastSent = null;
    this.#lastSentAtMs = Number.NEGATIVE_INFINITY;
    this.#inFlight = false;
  }
}
