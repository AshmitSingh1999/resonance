import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioFrame,
  ClientMsg,
  LightState,
  Lyrics,
  SettingsValues,
  NativeAudioState,
  ServerMsg,
  Track,
} from '@resonance/shared';
import { Connection, type ConnectionStatus } from './net/connection.js';
import { SyncClock } from './sync/clock.js';
import { viewAt, type ActiveLyricView } from './sync/scheduler.js';

const OFFSET_STORAGE_KEY = 'resonance.offsetMs';

export interface ResonanceHooks {
  /** Frames from the daemon's native capture, when it is running. */
  onAudioFrame?: (frame: AudioFrame) => void;
  onAudioState?: (state: NativeAudioState, detail?: string) => void;
}

export interface ResonanceState {
  connection: ConnectionStatus;
  track: Track | null;
  lyrics: Lyrics | null;
  /** Current position in the song, already including the latency offset. */
  positionMs: number;
  view: ActiveLyricView;
  playing: boolean;
  offsetMs: number;
  nudgeOffset: (deltaMs: number) => void;
  /** Local path to this track's audio preview, once the daemon has found one. */
  previewUrl: string | null;
  /** Bulb state and settings, or null when the daemon has not reported yet. */
  light: LightStatus | null;
  /** Daemon-owned settings by schema id, or null before it has reported. */
  daemonSettings: SettingsValues | null;
  /** Send a message to the daemon. No-op while disconnected. */
  send: (message: ClientMsg) => void;
}

export interface LightStatus {
  state: LightState;
  config: {
    enabled: boolean;
    mode: 'palette' | 'spectrum';
    updateHz: number;
    maxBrightness: number;
    configured: boolean;
  };
}

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development Vite proxies /ws to the daemon, so one URL works everywhere.
  return `${protocol}//${location.host}/ws`;
}

function loadOffset(): number {
  const stored = Number(localStorage.getItem(OFFSET_STORAGE_KEY));
  return Number.isFinite(stored) ? stored : 0;
}

/**
 * Connects to the daemon and turns its messages into something renderable.
 *
 * Position is driven by an animation frame rather than by incoming messages:
 * samples arrive every few seconds but the display needs a value every frame, and
 * the clock is what bridges that gap.
 */
export function useResonance(hooks: ResonanceHooks = {}): ResonanceState {
  // Held in a ref so the socket effect can stay mounted for the page's lifetime
  // rather than reconnecting whenever a callback identity changes.
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const clockRef = useRef(new SyncClock());
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [track, setTrack] = useState<Track | null>(null);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [playing, setPlaying] = useState(false);
  const [offsetMs, setOffsetMs] = useState(loadOffset);
  const [positionMs, setPositionMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [light, setLight] = useState<LightStatus | null>(null);
  const [daemonSettings, setDaemonSettings] = useState<SettingsValues | null>(null);
  const connectionRef = useRef<Connection | null>(null);

  // Keep the clock's offset in step with the control, without re-creating it.
  useEffect(() => {
    clockRef.current.offsetMs = offsetMs;
    localStorage.setItem(OFFSET_STORAGE_KEY, String(offsetMs));
  }, [offsetMs]);

  useEffect(() => {
    const handle = (message: ServerMsg) => {
      switch (message.t) {
        case 'track': {
          // The same song can be re-sent when late metadata arrives, such as
          // artwork. Resetting the clock then would restart the song visually.
          setTrack((previous) => {
            const isSameSong =
              previous !== null && message.track !== null && previous.id === message.track.id;
            if (!isSameSong) {
              clockRef.current.reset();
              setLyrics(null);
              setPositionMs(0);
              setPreviewUrl(null);
            }
            return message.track;
          });
          break;
        }
        case 'lyrics':
          setLyrics(message.lyrics);
          break;
        case 'preview':
          setPreviewUrl(message.url);
          break;
        case 'lightStatus':
          setLight({ state: message.state, config: message.config });
          break;
        case 'settings':
          setDaemonSettings(message.values);
          break;
        case 'audio':
          hooksRef.current.onAudioFrame?.(message.frame);
          break;
        case 'audioStatus':
          hooksRef.current.onAudioState?.(message.state, message.detail);
          break;
        case 'position':
          clockRef.current.applySample(message.state);
          setPlaying(message.state.playing);
          break;
        default:
          break;
      }
    };

    const connection = new Connection(socketUrl(), handle, setConnection);
    connectionRef.current = connection;
    connection.connect();

    // Ask for a fresh sample when the tab wakes: a backgrounded tab is throttled,
    // so its clock may have been running without correction for some time.
    const onVisible = () => {
      if (document.visibilityState === 'visible') connection.send({ t: 'resync' });
    };
    document.addEventListener('visibilitychange', onVisible);

    let frame = 0;
    const tick = () => {
      setPositionMs(clockRef.current.positionAt(Date.now()));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisible);
      connection.close();
      connectionRef.current = null;
    };
  }, []);

  const send = useCallback((message: ClientMsg) => {
    connectionRef.current?.send(message);
  }, []);

  return {
    connection,
    track,
    lyrics,
    positionMs,
    view: viewAt(lyrics, positionMs),
    playing,
    offsetMs,
    nudgeOffset: (deltaMs) => setOffsetMs((current) => current + deltaMs),
    previewUrl,
    light,
    daemonSettings,
    send,
  };
}
