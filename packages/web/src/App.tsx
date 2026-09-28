import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SettingsValues } from '@resonance/shared';
import { useResonance } from './useResonance.js';
import { useAudioSource } from './audio/useAudioSource.js';
import { SILENCE } from './audio/features.js';
import type { LiveAudio } from './audio/tap.js';
import { LyricStage } from './ui/LyricStage.js';
import { NowPlaying } from './ui/NowPlaying.js';
import { OffsetControl } from './ui/OffsetControl.js';
import { AudioPanel } from './ui/AudioPanel.js';
import { useTheme } from './theme/useTheme.js';
import { Backdrop } from './ui/Backdrop.js';
import { SettingsPanel } from './ui/settings/SettingsPanel.js';
import { useSettings } from './useSettings.js';
import { familyById } from './theme/families/index.js';
import { ProgressBar } from './ui/ProgressBar.js';
import type { ThemePins } from './theme/engine.js';
import { profilePreview, SILENT_PROFILE } from './theme/previewAnalysis.js';

/** How often the meters refresh. They are a diagnostic, not the display. */
const METER_INTERVAL_MS = 80;

const LIGHT_STATE_LABEL: Record<string, string> = {
  off: 'off',
  connecting: 'connecting…',
  live: 'connected',
  unreachable: 'bulb unreachable',
  unconfigured: 'not set up — run scripts/tuya-setup.sh',
};

export function App() {
  // `send` is needed before the socket exists, so it is forwarded through a ref
  // the connection fills in on mount.
  const sendRef = useRef<(message: Parameters<typeof send>[0]) => void>(() => {});
  const forward = useCallback(
    (message: Parameters<typeof send>[0]) => sendRef.current(message),
    [],
  );

  const [daemonSettingsSeen, setDaemonSettingsSeen] = useState<SettingsValues | null>(null);
  const [settings, setSetting] = useSettings(forward, daemonSettingsSeen);

  const tap = useAudioSource(settings['audioSource'] as 'native' | 'browser' | 'off');

  const {
    connection, track, lyrics, positionMs, view, playing,
    offsetMs, nudgeOffset, previewUrl, light, daemonSettings, send,
  } = useResonance({ onAudioFrame: tap.acceptFrame, onAudioState: tap.acceptState });
  sendRef.current = send;
  if (daemonSettings !== daemonSettingsSeen && daemonSettings !== null) {
    setDaemonSettingsSeen(daemonSettings);
  }

  const rootRef = useRef<HTMLElement>(null);
  const [meters, setMeters] = useState<LiveAudio>({ ...SILENCE, onset: false });
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * A slow average of loudness, used to characterise the track rather than the
   * moment. The theme reads this; per-frame motion reads the live values.
   */
  const energyRef = useRef(0);
  const [energy, setEnergy] = useState(0);

  /**
   * Character taken from the track's 30-second preview.
   *
   * Used only when no live audio is running. Without it the theme engine has no
   * energy signal at all and falls back to lyric density, which makes nearly
   * every track read as a quiet one.
   */
  const [preview, setPreview] = useState(SILENT_PROFILE);
  useEffect(() => {
    if (previewUrl === null) {
      setPreview(SILENT_PROFILE);
      return;
    }
    let cancelled = false;
    void profilePreview(previewUrl).then((profile) => {
      if (!cancelled && profile !== null) setPreview(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  // Read inside the frame loop so progress never becomes a per-frame re-render.
  const progressRef = useRef(0);
  progressRef.current =
    track?.durationMs == null ? 0 : Math.min(1, Math.max(0, positionMs / track.durationMs));
  // The engine composes the pins itself, so there is one place that decides what
  // the look is rather than a second pass patching it afterwards.
  const pins: ThemePins = useMemo(
    () => ({
      scheme: settings['scheme'] as ThemePins['scheme'],
      family: settings['family'] as ThemePins['family'],
      backdrop: settings['backdrop'] as ThemePins['backdrop'],
      layout: settings['layout'] as ThemePins['layout'],
    }),
    [settings['scheme'], settings['family'], settings['backdrop'], settings['layout']],
  );
  // Live audio wins; the preview stands in only when there is none.
  const themeEnergy = tap.state.status === 'listening' ? energy : preview.energy;
  const theme = useTheme(track, lyrics, themeEnergy, pins);

  // What the engine would pick unaided, shown against the `auto` chips.
  const autoFamily = useTheme(track, lyrics, themeEnergy).family;
  const autoBackdrop = familyById(autoFamily).defaultBackdrop;

  /**
   * Feed audio into CSS custom properties every frame.
   *
   * Written straight to the element rather than through React state: this runs at
   * 60fps, and re-rendering the lyric tree that often would be wasteful when the
   * only thing changing is a number the compositor can act on by itself.
   */
  useEffect(() => {
    let frame = 0;
    let lastMeterUpdate = 0;

    const tick = () => {
      const audio = tap.read();
      const root = rootRef.current;
      if (root !== null) {
        root.style.setProperty('--audio-bass', audio.bass.toFixed(3));
        root.style.setProperty('--audio-mid', audio.mid.toFixed(3));
        root.style.setProperty('--audio-treble', audio.treble.toFixed(3));
        root.style.setProperty('--audio-rms', audio.rms.toFixed(3));
        root.style.setProperty('--audio-bright', audio.centroid.toFixed(3));
        root.style.setProperty('--progress', progressRef.current.toFixed(5));
        if (audio.onset) {
          // Restart the beat animation by forcing a reflow between toggles.
          root.classList.remove('is-beat');
          void root.offsetWidth;
          root.classList.add('is-beat');
        }
      }

      // Long time constant: this describes the song, not the bar.
      energyRef.current += (audio.rms - energyRef.current) * 0.002;

      const now = performance.now();
      if (now - lastMeterUpdate > METER_INTERVAL_MS) {
        lastMeterUpdate = now;
        setMeters(audio);
        setEnergy(energyRef.current);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tap]);

  // Apply the theme as custom properties. Set on the element rather than held in
  // React so the stylesheet owns how each family uses them.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    root.style.setProperty('--theme-bg', theme.palette.background);
    root.style.setProperty('--theme-dim', theme.palette.dim);
    root.style.setProperty('--theme-accent', theme.palette.accent);
    root.style.setProperty('--theme-typeface', theme.typeface);
    root.style.setProperty('--theme-weight-min', String(theme.weightRange[0]));
    root.style.setProperty('--theme-weight-max', String(theme.weightRange[1]));
    root.style.setProperty('--theme-leading', String(theme.leading));
    root.style.setProperty('--theme-intensity', String(theme.intensity));

    // Semantic tokens derived once per theme. Everything chrome-related reads
    // these rather than a hardcoded light-on-dark colour, which is what lets a
    // light scheme work at all.
    const ink = theme.light ? '17, 16, 15' : '245, 246, 248';
    root.style.setProperty('--theme-ink', `rgb(${ink})`);
    root.style.setProperty('--theme-line', `rgba(${ink}, 0.18)`);
    root.style.setProperty('--theme-veil', `rgba(${ink}, 0.08)`);
    root.style.setProperty('--theme-shade', theme.light ? '#ffffff' : '#000000');
    root.classList.toggle('is-light', theme.light);
  }, [theme]);

  // Keep the bulb's colour in step with the screen. The palette is derived from
  // artwork with a canvas, so the daemon cannot compute it and the page sends it.
  useEffect(() => {
    if (light?.config.enabled !== true) return;
    send({ t: 'palette', accent: theme.palette.accent, background: theme.palette.background });
  }, [theme.palette.accent, theme.palette.background, light?.config.enabled, send]);

  // Arrow keys nudge the offset: calibrating by ear means adjusting while
  // listening, and reaching for the mouse breaks that loop. `m` toggles meters.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') nudgeOffset(-50);
      else if (event.key === 'ArrowRight') nudgeOffset(50);
      else if (event.key.toLowerCase() === 'm') setSetting('showMeters', !settings['showMeters']);
      else if (event.key.toLowerCase() === 's') setSettingsOpen((open) => !open);
      else if (event.key.toLowerCase() === 'f') {
        if (document.fullscreenElement === null) void document.documentElement.requestFullscreen();
        else void document.exitFullscreen();
      } else if (event.key === 'Escape') setSettingsOpen(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudgeOffset, settings, setSetting]);

  return (
    <main className={`app theme-${theme.family}`} ref={rootRef}>
      <Backdrop
        theme={theme}
        readAudio={tap.read}
        enabled={settings['backdropEnabled'] === true && theme.backdrop !== 'none'}
      />
      <LyricStage lyrics={lyrics} view={view} layout={theme.layout} />

      {track === null && (
        <div className="idle">
          <h1 className="idle__mark">Resonance</h1>
          <p className="idle__hint">
            {connection === 'open' ? 'waiting for something to play' : 'connecting to daemon…'}
          </p>
        </div>
      )}

      <ProgressBar visible={track !== null} />

      <footer className="hud">
        <NowPlaying track={track} positionMs={positionMs} playing={playing} />
        <div className="hud__right">
          <AudioPanel
            state={tap.state}
            audio={meters}
            showMeters={settings['showMeters'] === true}
            native={settings['audioSource'] === 'native'}
            onEnable={() => void tap.enable()}
            onDisable={tap.disable}
          />
          {track !== null && <OffsetControl offsetMs={offsetMs} onNudge={nudgeOffset} />}
          <span className="theme-badge" title="active typography family">
            {theme.family}
            {settings['family'] !== null && <span className="theme-badge__pin"> pinned</span>}
          </span>
          <button
            type="button"
            className="audio__toggle"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Settings"
          >
            settings
          </button>
          <span className={`status status--${connection}`}>{connection}</span>
        </div>
      </footer>

      <SettingsPanel
        open={settingsOpen}
        values={settings}
        autoLabels={{ family: autoFamily, backdrop: autoBackdrop, scheme: 'artwork' }}
        lightsStatus={light === null ? undefined : LIGHT_STATE_LABEL[light.state] ?? light.state}
        onChange={setSetting}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
}
