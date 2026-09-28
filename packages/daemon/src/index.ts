/**
 * The daemon: watch what is playing, find the words, push both to the page.
 *
 * Usage:
 *   npm start                # real playback
 *   npm start -- --fake      # scripted timeline, no music required
 */
import type { Lyrics, PlaybackState, ServerMsg, Track } from '@resonance/shared';
import { MediaRemoteSource } from './nowplaying/mediaRemote.js';
import { FakeNowPlayingSource, demoScript } from './nowplaying/fake.js';
import type { NowPlayingSource } from './nowplaying/source.js';
import { LyricsCache } from './lyrics/cache.js';
import { LyricsResolver } from './lyrics/resolver.js';
import { ResonanceServer } from './server.js';
import {
  adapterScriptPath,
  adapterFrameworkPath,
  assertAdapterBuilt,
  audioHelperPath,
  cachePath,
  lightConfigPath,
  tuyaBridgePath,
  tuyaPythonPath,
  webDistPath,
} from './paths.js';
import { AudioFeatureSource } from './audio/featureSource.js';
import { LightBridge } from './light/bridge.js';
import { LightController } from './light/controller.js';
import { loadLightConfig } from './light/config.js';
import { configChangesFromSettings, settingsFromConfig } from './light/settingsBridge.js';
import { findPreviewUrl } from './audio/preview.js';
import { existsSync } from 'node:fs';

const PORT = Number(process.env['RESONANCE_PORT'] ?? 4747);
const useFake = process.argv.includes('--fake');

function buildSource(): NowPlayingSource {
  if (useFake) return new FakeNowPlayingSource(demoScript);
  assertAdapterBuilt();
  return new MediaRemoteSource({
    scriptPath: adapterScriptPath,
    frameworkPath: adapterFrameworkPath,
  });
}

const source = buildSource();
const resolver = new LyricsResolver(new LyricsCache(cachePath));

/**
 * The daemon holds current state so a client connecting mid-song is replayed it
 * immediately, rather than staring at an empty screen until the next track.
 */
let currentTrack: Track | null = null;
let currentLyrics: Lyrics | null = null;
let currentPosition: PlaybackState | null = null;

/** Upstream preview URLs, keyed by track, so the proxy route can find them. */
const previewUrls = new Map<string, string>();

const audio = new AudioFeatureSource(audioHelperPath);

const light = new LightController(
  new LightBridge(tuyaPythonPath, tuyaBridgePath, lightConfigPath),
  loadLightConfig(lightConfigPath),
  lightConfigPath,
);

const server = new ResonanceServer({
  port: PORT,
  webRoot: existsSync(webDistPath) ? webDistPath : null,
  onConnect: (send) => {
    send({ t: 'hello', serverTimeMs: Date.now(), source: source.kind });
    send({ t: 'track', track: currentTrack });
    if (currentTrack !== null && currentLyrics !== null) {
      send({ t: 'lyrics', trackId: currentTrack.id, lyrics: currentLyrics });
    }
    if (currentPosition !== null) send({ t: 'position', state: currentPosition });

    // Replay audio state and any known preview too: a client connecting mid-song
    // must learn what the daemon already knows, or it sits in a stale idle state
    // until something happens to change.
    send({ t: 'audioStatus', state: audio.state });
    send({ t: 'lightStatus', state: light.state, config: publicLightConfig() });
    send({ t: 'settings', values: settingsFromConfig(light.config) });
    if (currentTrack !== null) {
      const preview = previewUrls.get(currentTrack.id);
      if (preview !== undefined) {
        send({
          t: 'preview',
          trackId: currentTrack.id,
          url: `/preview/${encodeURIComponent(currentTrack.id)}`,
        });
      }
    }
  },
  onClientMessage: (message) => {
    if (message.t === 'resync') void source.resync().catch(() => {});
    // The palette is derived from artwork with a canvas, which only the page
    // has — so it is sent down rather than computed here.
    else if (message.t === 'palette') {
      light.setPalette({ accent: message.accent, background: message.background });
    } else if (message.t === 'lightConfig') {
      const { t: _ignored, ...changes } = message;
      light.updateConfig(changes);
      broadcast({ t: 'lightStatus', state: light.state, config: publicLightConfig() });
    } else if (message.t === 'settings') {
      // Only ids the schema marks daemon-owned are applied, and each is
      // re-validated: the page is a separate process and cannot be trusted to
      // send a rate the bulb can survive.
      light.updateConfig(configChangesFromSettings(message.values));
      broadcast({ t: 'settings', values: settingsFromConfig(light.config) });
      broadcast({ t: 'lightStatus', state: light.state, config: publicLightConfig() });
    }
  },
  previewUrlFor: (trackId) => previewUrls.get(trackId) ?? null,
});

function broadcast(message: ServerMsg): void {
  server.broadcast(message);
}

source.on('track', (track) => {
  // A track event can be a genuinely new song, or the same song with metadata
  // that arrived late (artwork in particular). Only the former should discard
  // the lyrics and start a fresh lookup.
  const isSameSong = track !== null && currentTrack !== null && track.id === currentTrack.id;
  currentTrack = track;
  broadcast({ t: 'track', track });

  if (track === null) {
    currentLyrics = null;
    broadcast({ t: 'status', phase: 'idle' });
    return;
  }

  if (isSameSong) return;
  currentLyrics = null;

  // A preview characterises the track for the theme when no live audio runs.
  // Failure is silent and harmless — the theme simply keeps its other signals.
  void findPreviewUrl({
    artist: track.artist,
    title: track.title,
    durationMs: track.durationMs,
  }).then((url) => {
    if (currentTrack?.id !== track.id || url === null) return;
    previewUrls.set(track.id, url);
    broadcast({ t: 'preview', trackId: track.id, url: `/preview/${encodeURIComponent(track.id)}` });
  });

  broadcast({ t: 'status', phase: 'resolving', detail: `${track.artist} - ${track.title}` });
  void resolver
    .resolve(track)
    .then((lyrics) => {
      // A slow lookup can finish after the song already changed; dropping it
      // avoids showing one track's words over another's.
      if (currentTrack?.id !== track.id) return;
      currentLyrics = lyrics;
      broadcast({ t: 'lyrics', trackId: track.id, lyrics });
      broadcast({ t: 'status', phase: 'ready', detail: lyrics.kind });
    })
    .catch((error: unknown) => {
      if (currentTrack?.id !== track.id) return;
      broadcast({ t: 'status', phase: 'error', detail: (error as Error).message });
    });
});

source.on('position', (state) => {
  currentPosition = state;
  broadcast({ t: 'position', state });
});

source.on('error', (error) => {
  console.error(`[resonance] ${error.message}`);
});

/** Behavioural settings only: device credentials never reach the browser. */
function publicLightConfig() {
  const { enabled, mode, updateHz, maxBrightness, device } = light.config;
  return { enabled, mode, updateHz, maxBrightness, configured: device !== null };
}

audio.on('frame', (frame) => {
  broadcast({ t: 'audio', frame });
  // Most frames are discarded by the light's own throttle; a bulb cannot take
  // anything close to 30Hz.
  light.push(frame, Date.now());
});
audio.on('state', (state, detail) =>
  broadcast(detail === undefined ? { t: 'audioStatus', state } : { t: 'audioStatus', state, detail }),
);

const shutdown = () => {
  light.stop();
  audio.stop();
  void Promise.allSettled([source.stop(), server.stop()]).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.start();
await source.start();
audio.start();
light.start();
console.log(`[resonance] listening on http://localhost:${PORT}  (source: ${source.kind})`);
console.log(
  audio.state === 'unsupported'
    ? '[resonance] native audio helper not built — run native/resonance-audio/build.sh'
    : '[resonance] native audio capture starting (no screen sharing required)',
);
if (!existsSync(webDistPath)) {
  console.log('[resonance] web UI not built; run `npm run web` for the dev server');
}
