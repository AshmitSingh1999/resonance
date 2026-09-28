import type { AudioFrame, NativeAudioState } from '@resonance/shared';
import { SILENCE } from './features.js';
import type { LiveAudio, TapState } from './tap.js';

/**
 * Where per-frame audio features come from.
 *
 * Two implementations sit behind this: the native helper (features arrive over
 * the WebSocket, no permission prompt after the first) and in-page capture (the
 * browser's own analyser, but a screen-share picker every session). The renderer
 * only ever calls `read()`, so it neither knows nor cares which is active — the
 * same arrangement as `NowPlayingSource` in the daemon, for the same reason.
 */
export interface AudioSource {
  readonly kind: 'native' | 'browser';
  readonly state: TapState;
  read(): LiveAudio;
  stop(): void;
}

/** Map the daemon's capture state onto what the panel already knows how to show. */
export function tapStateForNative(state: NativeAudioState, detail?: string): TapState {
  switch (state) {
    case 'live':
      return { status: 'listening' };
    case 'starting':
      return { status: 'starting' };
    case 'denied':
      return { status: 'unavailable', reason: detail ?? 'system audio permission denied' };
    case 'unsupported':
      return { status: 'unavailable', reason: detail ?? 'audio helper not available' };
    default:
      return { status: 'idle' };
  }
}

/**
 * Features streamed from the daemon's native helper.
 *
 * Frames arrive at roughly 30Hz while the renderer reads at 60, so each frame is
 * read more than once. Onsets are therefore latched and cleared on read: without
 * that, a single beat would fire the animation twice and read as a stutter.
 */
export class NativeAudioSource implements AudioSource {
  readonly kind = 'native';

  #latest: LiveAudio = { ...SILENCE, onset: false };
  #onsetPending = false;
  #state: TapState = { status: 'idle' };

  get state(): TapState {
    return this.#state;
  }

  acceptFrame(frame: AudioFrame): void {
    this.#latest = { ...frame, onset: false };
    if (frame.onset) this.#onsetPending = true;
    if (this.#state.status !== 'listening') this.#state = { status: 'listening' };
  }

  acceptState(state: NativeAudioState, detail?: string): void {
    this.#state = tapStateForNative(state, detail);
  }

  read(): LiveAudio {
    if (this.#state.status !== 'listening') return { ...SILENCE, onset: false };
    const onset = this.#onsetPending;
    this.#onsetPending = false;
    return { ...this.#latest, onset };
  }

  stop(): void {
    this.#state = { status: 'idle' };
    this.#latest = { ...SILENCE, onset: false };
    this.#onsetPending = false;
  }
}

/** A source that is switched off, so callers need no null handling. */
export class SilentAudioSource implements AudioSource {
  readonly kind = 'native';
  readonly state: TapState = { status: 'idle' };
  read(): LiveAudio {
    return { ...SILENCE, onset: false };
  }
  stop(): void {}
}
