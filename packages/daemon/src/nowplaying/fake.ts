import { EventEmitter } from 'node:events';
import type { PlaybackState, SourceKind, Track } from '@resonance/shared';
import { trackIdOf } from '@resonance/shared';
import type { NowPlayingEvents, NowPlayingSource } from './source.js';

/** One scripted moment: at `atMs` after start, the source reports this. */
export interface ScriptStep {
  atMs: number;
  track?: Omit<Track, 'id' | 'source' | 'inferred'> & Partial<Pick<Track, 'inferred'>>;
  playing?: boolean;
  /** Jump the reported position, to exercise seek handling. */
  seekToMs?: number;
}

/**
 * A now-playing source that replays a scripted timeline.
 *
 * Exists so the resolver, server and entire UI can be developed and demonstrated
 * with no music playing, no network, and no dependence on a private API — and so
 * awkward moments (a seek, a pause, a track with no lyrics) can be reproduced on
 * demand instead of waited for.
 */
export class FakeNowPlayingSource extends EventEmitter implements NowPlayingSource {
  readonly kind: SourceKind = 'fake';

  #timers: NodeJS.Timeout[] = [];
  #ticker: NodeJS.Timeout | null = null;
  #position: PlaybackState | null = null;

  constructor(
    private readonly script: ScriptStep[],
    /**
     * How often to report position, mirroring a real source's sampling. Without
     * this the script would fall silent between steps and the UI would have
     * nothing to render, which defeats the point of the fake.
     */
    private readonly tickMs = 2_000,
    /** Replay the script forever, so a UI session is not limited to its length. */
    private readonly loop = true,
  ) {
    super();
  }

  override on<E extends keyof NowPlayingEvents>(event: E, listener: NowPlayingEvents[E]): this {
    return super.on(event, listener);
  }

  async start(): Promise<void> {
    this.#schedule(0);
    // Deliberately not unref'd: this is the only work holding the event loop.
    this.#ticker = setInterval(() => void this.resync(), this.tickMs);
  }

  #schedule(baseMs: number): void {
    for (const step of this.script) {
      this.#timers.push(setTimeout(() => this.#apply(step), baseMs + step.atMs));
    }
    if (!this.loop) return;

    const length = this.script.reduce((max, step) => Math.max(max, step.atMs), 0) + this.tickMs;
    this.#timers.push(setTimeout(() => this.#schedule(0), baseMs + length));
  }

  async stop(): Promise<void> {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers = [];
    if (this.#ticker !== null) clearInterval(this.#ticker);
    this.#ticker = null;
  }

  async resync(): Promise<void> {
    if (this.#position === null) return;
    // Extrapolate as a real player would, so drift handling gets exercised.
    const now = Date.now();
    const advanced = (now - this.#position.sampledAtMs) * this.#position.rate;
    this.#position = {
      ...this.#position,
      positionMs: this.#position.positionMs + advanced,
      sampledAtMs: now,
    };
    this.emit('position', this.#position);
  }

  #apply(step: ScriptStep): void {
    const now = Date.now();

    if (step.track) {
      const track: Track = {
        ...step.track,
        id: trackIdOf(step.track),
        source: 'fake',
        inferred: step.track.inferred ?? false,
      };
      this.emit('track', track);
      this.#position = { playing: true, positionMs: 0, sampledAtMs: now, rate: 1 };
    }

    if (this.#position === null) return;

    if (step.seekToMs !== undefined) {
      this.#position = { ...this.#position, positionMs: step.seekToMs, sampledAtMs: now };
    }
    if (step.playing !== undefined) {
      this.#position = {
        ...this.#position,
        playing: step.playing,
        rate: step.playing ? 1 : 0,
        sampledAtMs: now,
      };
    }
    this.emit('position', this.#position);
  }
}

/** A short demo timeline: play, seek, pause, resume, next track. */
export const demoScript: ScriptStep[] = [
  {
    atMs: 0,
    track: {
      title: 'Lioness',
      artist: 'Swedish House Mafia',
      album: 'Lioness',
      durationMs: 193_000,
      artworkDataUrl: null,
      bundleId: 'fake',
    },
  },
  { atMs: 20_000, seekToMs: 60_000 },
  { atMs: 50_000, playing: false },
  { atMs: 56_000, playing: true },
  {
    atMs: 110_000,
    track: {
      title: 'Hello',
      artist: 'Adele',
      album: '25',
      durationMs: 295_000,
      artworkDataUrl: null,
      bundleId: 'fake',
    },
  },
];
