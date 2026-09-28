/**
 * The wire contract between the daemon and the browser.
 *
 * Both sides import these types, so the protocol cannot drift. Everything that
 * crosses the WebSocket is a `ServerMsg`; everything the page sends back is a
 * `ClientMsg`.
 */

/** Where the now-playing information came from. */
export type SourceKind = 'mediaremote' | 'applescript' | 'fake';

/** A track as the daemon understands it, after normalization. */
export interface Track {
  /** Stable identity for caching: normalized artist + title + duration bucket. */
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  /** `data:image/jpeg;base64,...` when the player supplied artwork. */
  artworkDataUrl: string | null;
  /** e.g. `com.spotify.client`, `com.apple.Music`, `com.google.Chrome`. */
  bundleId: string | null;
  source: SourceKind;
  /**
   * True when the metadata was parsed out of a browser tab title rather than
   * reported as structured fields. Such tracks are lower-confidence and the
   * lyric resolver treats them differently.
   */
  inferred: boolean;
}

/** Playback state at a known instant. */
export interface PlaybackState {
  playing: boolean;
  /** Position within the track at `sampledAtMs`. */
  positionMs: number;
  /** Daemon-side `Date.now()` when this position was true. */
  sampledAtMs: number;
  /** 1 for normal speed, 0 when paused. */
  rate: number;
}

/** One line of lyrics, with the window during which it is the active line. */
export interface LyricLine {
  startMs: number;
  /** End of this line's window: the next line's start, or track end. */
  endMs: number;
  text: string;
  /** Present only when true word-level timings are known (enhanced LRC or alignment). */
  words?: { text: string; offsetMs: number }[];
}

export type LyricsKind = 'synced' | 'plain' | 'none';

export interface Lyrics {
  kind: LyricsKind;
  lines: LyricLine[];
  /** Provenance, e.g. `lrclib:13698321`. Null for `none`. */
  sourceId: string | null;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** The kinetic typography catalogue. Each family is a renderer module. */
export type AnimationFamily =
  | 'serene'
  | 'pulse'
  | 'cascade'
  | 'drift'
  | 'fracture'
  | 'editorial'
  | 'marquee';

/** Colour treatment, applied over (or instead of) the artwork palette. */
export type SchemeId = 'artwork' | 'midnight' | 'paper' | 'neon' | 'mono';

/** The animated field behind the lyrics, selectable independently of the family. */
export type BackdropId =
  // Ambient fields, driven by the scalar features alone.
  | 'waves'
  | 'rings'
  | 'streaks'
  | 'flow'
  | 'scan'
  // Visualizers, which read the spectrum or waveform arrays.
  | 'bars'
  | 'none';

/**
 * How assertive the visuals are relative to the lyrics.
 *
 * `full` hides the lyric stack entirely; the now-playing HUD stays, so it is
 * still obvious what is playing.
 */
export type Prominence = 'subtle' | 'bold' | 'full';

/** How the lyric stack is arranged on screen. */
export type LayoutId = 'centred' | 'rail' | 'band';

export interface Palette {
  /** Page background. */
  background: string;
  /** Inactive lyric lines. */
  dim: string;
  /** The active line. */
  accent: string;
}

/**
 * How a track should look.
 *
 * Composed from four dimensions that vary independently — colour, typography,
 * backdrop and arrangement — so a disagreeable automatic choice can be corrected
 * one dimension at a time rather than by swapping the whole look.
 */
export interface Theme {
  family: AnimationFamily;
  scheme: SchemeId;
  backdrop: BackdropId;
  layout: LayoutId;
  /** True when the scheme puts dark ink on a light ground. */
  light: boolean;
  /** CSS font-family stack. */
  typeface: string;
  /** Variable-font weight axis range the renderer animates between. */
  weightRange: [number, number];
  case: 'none' | 'upper';
  palette: Palette;
  /** Baseline motion amplitude, 0..1. Audio energy modulates around this. */
  intensity: number;
  /** CSS line-height for the lyric stack. */
  leading: number;
}

// ---------------------------------------------------------------------------
// Wire messages
// ---------------------------------------------------------------------------

/**
 * One frame of audio features.
 *
 * Deliberately identical to what the browser's own analyser produces, so the
 * renderer cannot tell — and does not need to know — whether a frame came from
 * the native helper or from in-page capture.
 */
export interface AudioFrame {
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  centroid: number;
  onset: boolean;
  /** 64 log-spaced frequency bands, base64 of bytes. Empty when unavailable. */
  spectrum: string;
  /** 128 time-domain points centred on 128, base64 of bytes. */
  waveform: string;
}

/** What drives the bulb's colour. */
export type LightMode = 'palette' | 'spectrum';

/** Reported to the UI so it can show why the light is or is not responding. */
export type LightState = 'off' | 'connecting' | 'live' | 'unreachable' | 'unconfigured';

/** State of the daemon's native audio capture. */
export type NativeAudioState =
  | 'off'
  | 'starting'
  | 'live'
  /** The system-audio permission was refused. */
  | 'denied'
  /** No helper binary, or macOS too old for process taps. */
  | 'unsupported';

export type ServerMsg =
  | { t: 'hello'; serverTimeMs: number; source: SourceKind }
  /** A new track started, or metadata changed. `null` means nothing is playing. */
  | { t: 'track'; track: Track | null }
  | { t: 'lyrics'; trackId: string; lyrics: Lyrics }
  | { t: 'theme'; trackId: string; theme: Theme }
  /** Authoritative position, used by the client's SyncClock to discipline drift. */
  | { t: 'position'; state: PlaybackState }
  /** Resolver progress, so the UI can show why the screen is still empty. */
  | { t: 'status'; phase: 'idle' | 'resolving' | 'ready' | 'error'; detail?: string }
  /** A frame of features from the native audio helper. */
  | { t: 'audio'; frame: AudioFrame }
  | { t: 'audioStatus'; state: NativeAudioState; detail?: string }
  /**
   * Bulb state and the settings the UI may change.
   *
   * Deliberately carries no device id or local key: those stay in the daemon's
   * config file and never cross to the browser.
   */
  /** Daemon-owned settings as the daemon currently holds them. */
  | { t: 'settings'; values: Record<string, number | boolean | string | null> }
  | {
      t: 'lightStatus';
      state: LightState;
      config: {
        enabled: boolean;
        mode: LightMode;
        updateHz: number;
        maxBrightness: number;
        /** True once the setup script has stored device credentials. */
        configured: boolean;
      };
    }
  /**
   * A 30-second preview is available at this path, for characterising the track
   * when no live audio is running.
   */
  | { t: 'preview'; trackId: string; url: string | null };

export type ClientMsg =
  /** Client asks for a fresh position sample (e.g. on tab focus). */
  | { t: 'resync' }
  /** Client requests a full re-send of current state (e.g. after reconnect). */
  | { t: 'hello' }
  /**
   * The colours the page is currently showing.
   *
   * The palette is derived from album artwork using a canvas, which only the
   * browser has — so the daemon cannot compute it and the page must send it
   * down for the bulb to match what is on screen.
   */
  | { t: 'palette'; accent: string; background: string }
  /** Behavioural light settings from the UI. Never carries device credentials. */
  | { t: 'lightConfig'; enabled?: boolean; mode?: LightMode; updateHz?: number; maxBrightness?: number }
  /**
   * Daemon-owned settings, keyed by schema id.
   *
   * Only ids the schema marks `owner: 'daemon'` are accepted; anything else is
   * ignored, so the page cannot write to state it does not own.
   */
  | { t: 'settings'; values: Record<string, number | boolean | string | null> };
