import type { AudioFrame, LightState } from '@resonance/shared';
import { LightBridge } from './bridge.js';
import { ColourThrottle } from './throttle.js';
import { mapToColour, type LightPalette } from './mapping.js';
import { encodeMusicData } from './musicData.js';
import { saveLightConfig, type LightConfig } from './config.js';

/**
 * Joins audio features to the bulb.
 *
 * Audio arrives at 30Hz and the device can take a fraction of that, so the
 * throttle — not this class — decides what actually gets sent. Everything here
 * is arranged so that a bulb which is slow, offline or absent cannot affect the
 * display: sends are fire-and-forget and failures only change reported state.
 */
export class LightController {
  readonly #throttle: ColourThrottle;
  #palette: LightPalette | null = null;
  #config: LightConfig;

  constructor(
    private readonly bridge: LightBridge,
    config: LightConfig,
    private readonly configPath: string,
  ) {
    this.#config = config;
    this.#throttle = new ColourThrottle({ minIntervalMs: 1000 / config.updateHz });
    // Real flow control: the slot reopens when the bridge says the write is out,
    // not when we hand it over. At high rates the difference is the whole game.
    bridge.on('wrote', () => this.#throttle.complete());
  }

  get state(): LightState {
    return this.#config.enabled ? this.bridge.state : 'off';
  }

  get config(): LightConfig {
    return this.#config;
  }

  start(): void {
    if (this.#config.enabled && this.#config.device !== null) this.bridge.start();
  }

  stop(): void {
    this.bridge.stop();
  }

  /** The page's current colours, used by palette mode. */
  setPalette(palette: LightPalette | null): void {
    this.#palette = palette;
    // A new track means a new colour worth sending even if the audio is steady.
    this.#throttle.reset();
  }

  /** Apply behavioural settings from the UI. Credentials are never touched here. */
  updateConfig(changes: Partial<Omit<LightConfig, 'device'>>): void {
    const wasEnabled = this.#config.enabled;
    this.#config = { ...this.#config, ...changes };
    this.#throttle.setMinInterval(1000 / this.#config.updateHz);
    saveLightConfig(this.configPath, this.#config);

    if (this.#config.enabled && !wasEnabled) this.start();
    else if (!this.#config.enabled && wasEnabled) this.bridge.stop();
  }

  /** Offer an audio frame. Most are dropped, which is the point. */
  push(audio: AudioFrame, nowMs: number): void {
    if (!this.#config.enabled || !this.bridge.connected) return;

    const colour = mapToColour(audio, this.#config.mode, this.#palette, {
      maxBrightness: this.#config.maxBrightness,
    });
    if (!this.#throttle.offer(colour, nowMs)) return;

    const payload = encodeMusicData({
      // Gradient rather than jump: the bulb interpolates between updates, which
      // covers the gaps the throttle deliberately leaves.
      mode: 'gradient',
      h: colour.h,
      s: colour.s,
      v: colour.v,
      bright: colour.v,
      temp: 0,
    });

    // On failure release immediately; on success wait for the bridge's ack so a
    // slow writer throttles us rather than silently filling the pipe.
    if (!this.bridge.send({ cmd: 'colour', h: colour.h, s: colour.s, v: colour.v, payload })) {
      this.#throttle.fail();
    }
  }
}
