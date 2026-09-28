import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { AudioFrame, NativeAudioState } from '@resonance/shared';
import { parseHelperLine, stateForErrorCode } from './frames.js';

export interface FeatureSourceEvents {
  frame: (frame: AudioFrame) => void;
  state: (state: NativeAudioState, detail?: string) => void;
}

/**
 * System-audio features from the native helper.
 *
 * Structured like `MediaRemoteSource`: spawn a child, read NDJSON per line off
 * stdout, surface stderr as diagnostics. That pattern is already proven here for
 * the MediaRemote adapter, and reusing it means the failure modes are familiar.
 *
 * The helper needs the macOS system-audio permission, which is granted once and
 * remembered — unlike the browser's screen-share picker, which cannot persist.
 */
export class AudioFeatureSource extends EventEmitter {
  #child: ChildProcess | null = null;
  #stopping = false;
  #state: NativeAudioState = 'off';

  constructor(private readonly binaryPath: string) {
    super();
  }

  get state(): NativeAudioState {
    return this.#state;
  }

  override on<E extends keyof FeatureSourceEvents>(
    event: E,
    listener: FeatureSourceEvents[E],
  ): this {
    return super.on(event, listener);
  }

  #setState(state: NativeAudioState, detail?: string): void {
    this.#state = state;
    this.emit('state', state, detail);
  }

  start(): void {
    if (!existsSync(this.binaryPath)) {
      // Not an error: the helper is optional and the browser tap still works.
      this.#setState('unsupported', 'audio helper not built');
      return;
    }

    this.#stopping = false;
    this.#setState('starting');

    const child = spawn(this.binaryPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.#child = child;

    createInterface({ input: child.stdout! }).on('line', (line) => {
      const parsed = parseHelperLine(line);
      switch (parsed.kind) {
        case 'frame':
          // The first frame is the real signal that capture is running; `ready`
          // is printed before any audio has been seen.
          if (this.#state !== 'live') this.#setState('live');
          this.emit('frame', parsed.frame);
          break;
        case 'error':
          this.#setState(stateForErrorCode(parsed.code), parsed.message);
          break;
        default:
          break;
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      // The helper logs its own progress here; only surface genuine trouble.
      if (text !== '' && !text.startsWith('resonance-audio:')) {
        console.error(`[resonance] audio helper: ${text}`);
      }
    });

    child.on('exit', (code) => {
      this.#child = null;
      if (this.#stopping) return;
      // A non-zero exit before any frame usually means permission was refused;
      // the helper has already reported the specific reason if it could.
      if (this.#state !== 'denied' && this.#state !== 'unsupported') {
        this.#setState('off', `audio helper exited (${code})`);
      }
    });
  }

  stop(): void {
    this.#stopping = true;
    this.#child?.kill('SIGTERM');
    this.#child = null;
    this.#setState('off');
  }
}
