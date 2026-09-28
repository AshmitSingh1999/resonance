import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { SourceKind } from '@resonance/shared';
import type { NowPlayingEvents, NowPlayingSource } from './source.js';
import {
  mergePayload,
  toPlaybackState,
  toTrack,
  type AdapterEnvelope,
  type AdapterPayload,
} from './payload.js';
import { isScriptable, probePosition } from './positionProbe.js';

/** Apple platform binary; the entitlement gate is on the process, not the API. */
const PERL = '/usr/bin/perl';

export interface MediaRemoteOptions {
  /** Path to `bin/mediaremote-adapter.pl`. */
  scriptPath: string;
  /** Path to the built `MediaRemoteAdapter.framework`. */
  frameworkPath: string;
  /**
   * How often to sample an authoritative position, in milliseconds.
   *
   * The stream only emits on change, so a track can play for minutes without a
   * single event and the client's clock would have nothing to discipline it.
   * The AppleScript probe costs around 130ms, so a few seconds between samples
   * is cheap.
   */
  positionPollMs?: number;
}

/**
 * Now-playing via Apple's MediaRemote framework, reached through `/usr/bin/perl`.
 *
 * Since macOS 15.4 `MRMediaRemoteGetNowPlayingInfo` only answers processes with an
 * Apple platform signature. `/usr/bin/perl` has one, so the adapter loads the
 * framework inside perl and relays the result as NDJSON on stdout.
 */
export class MediaRemoteSource extends EventEmitter implements NowPlayingSource {
  readonly kind: SourceKind = 'mediaremote';

  #child: ChildProcess | null = null;
  #state: AdapterPayload = {};
  #lastTrackId: string | null = null;
  #lastTrackSignature: string | null = null;
  #pollTimer: NodeJS.Timeout | null = null;
  #stopping = false;

  constructor(private readonly options: MediaRemoteOptions) {
    super();
  }

  override on<E extends keyof NowPlayingEvents>(event: E, listener: NowPlayingEvents[E]): this {
    return super.on(event, listener);
  }

  async start(): Promise<void> {
    this.#stopping = false;
    this.#spawnStream();
    // Seed immediately: the stream may stay silent until playback changes.
    await this.resync();
    const interval = this.options.positionPollMs ?? 5_000;
    this.#pollTimer = setInterval(() => {
      void this.resync().catch((error: unknown) => this.emit('error', error as Error));
    }, interval);
    this.#pollTimer.unref();
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    this.#child?.kill('SIGTERM');
    this.#child = null;
  }

  /**
   * Refresh position from the most authoritative channel available.
   *
   * For Spotify and Apple Music this asks the app directly over AppleScript and
   * gets ground truth, so no extrapolation error can accumulate. For anything
   * else — browsers, in particular — it re-emits the last streamed sample, which
   * carries its own `timestamp` for the client to extrapolate from.
   *
   * Note this does not poll the adapter's `get` command. On this build `get`
   * returns an empty payload even while a track is plainly playing, whereas
   * `stream` reports correctly; relying on `get` produced spurious "nothing
   * playing" transitions.
   */
  async resync(): Promise<void> {
    const bundleId = typeof this.#state['bundleIdentifier'] === 'string'
      ? (this.#state['bundleIdentifier'] as string)
      : null;

    if (isScriptable(bundleId)) {
      const probed = await probePosition(bundleId);
      if (probed !== null) {
        this.emit('position', probed);
        return;
      }
    }

    this.#emitPosition(this.#state);
  }

  #spawnStream(): void {
    const child = spawn(
      PERL,
      [this.options.scriptPath, this.options.frameworkPath, 'stream'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.#child = child;

    const lines = createInterface({ input: child.stdout! });
    lines.on('line', (line) => this.#handleLine(line));

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text !== '') this.emit('error', new Error(`adapter stderr: ${text}`));
    });

    child.on('exit', (code) => {
      if (this.#stopping) return;
      this.emit('error', new Error(`adapter exited unexpectedly with code ${code}`));
    });
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return;

    let envelope: AdapterEnvelope;
    try {
      envelope = JSON.parse(trimmed) as AdapterEnvelope;
    } catch {
      // The adapter prints human-readable diagnostics on stdout for bad usage.
      this.emit('error', new Error(`unparseable adapter output: ${trimmed.slice(0, 200)}`));
      return;
    }

    this.#state = mergePayload(this.#state, envelope);

    const track = toTrack(this.#state);
    const trackId = track?.id ?? null;
    // Compare the whole track, not just its id. Artwork is fetched lazily by the
    // player and arrives in a later diff without changing the id, so keying on
    // the id alone silently dropped it — and the theme's palette depends on it.
    const signature = track === null ? null : JSON.stringify(track);
    if (signature !== this.#lastTrackSignature) {
      this.#lastTrackId = trackId;
      this.#lastTrackSignature = signature;
      this.emit('track', track);
    }
    this.#emitPosition(this.#state);
  }

  #emitPosition(payload: AdapterPayload): void {
    const state = toPlaybackState(payload, Date.now());
    if (state !== null) this.emit('position', state);
  }
}
