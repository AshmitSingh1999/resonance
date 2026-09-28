import type { PlaybackState, SourceKind, Track } from '@resonance/shared';

export interface NowPlayingEvents {
  /** A different track started, or its metadata changed. Null when nothing plays. */
  track: (track: Track | null) => void;
  /** An authoritative position sample. */
  position: (state: PlaybackState) => void;
  /** The source failed; the daemon decides whether to fall back or retry. */
  error: (error: Error) => void;
}

/**
 * A provider of now-playing information.
 *
 * The MediaRemote implementation depends on a private-API workaround that a macOS
 * update could break, so every consumer talks to this interface instead. That lets
 * an AppleScript fallback or a scripted fake be dropped in without touching the
 * server, resolver, or UI.
 */
export interface NowPlayingSource {
  readonly kind: SourceKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Request a fresh position sample; resolves once one has been emitted. */
  resync(): Promise<void>;
  on<E extends keyof NowPlayingEvents>(event: E, listener: NowPlayingEvents[E]): void;
}
