/**
 * Phase 1 deliverable: watch now-playing and print what the daemon sees.
 *
 * Usage:
 *   npm run daemon            # real MediaRemote source
 *   npm run daemon -- --fake  # scripted timeline, no music required
 */
import type { NowPlayingSource } from './nowplaying/source.js';
import { MediaRemoteSource } from './nowplaying/mediaRemote.js';
import { FakeNowPlayingSource, demoScript } from './nowplaying/fake.js';
import { adapterScriptPath, adapterFrameworkPath, assertAdapterBuilt } from './paths.js';
import { LyricsCache } from './lyrics/cache.js';
import { LyricsResolver } from './lyrics/resolver.js';
import { cachePath } from './paths.js';
import type { Lyrics } from '@resonance/shared';

const ESC = '\x1b[';
const green = (s: string) => `${ESC}32m${s}${ESC}0m`;
const dim = (s: string) => `${ESC}2m${s}${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${ESC}0m`;
const cyan = (s: string) => `${ESC}36m${s}${ESC}0m`;
const red = (s: string) => `${ESC}31m${s}${ESC}0m`;

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function buildSource(): NowPlayingSource {
  if (process.argv.includes('--fake')) {
    console.log(dim('source: fake (scripted timeline)'));
    return new FakeNowPlayingSource(demoScript);
  }
  assertAdapterBuilt();
  console.log(dim('source: mediaremote (via /usr/bin/perl)'));
  return new MediaRemoteSource({
    scriptPath: adapterScriptPath,
    frameworkPath: adapterFrameworkPath,
  });
}

const source = buildSource();

/**
 * The client-side clock, in miniature.
 *
 * A sample says "position P was true at instant T". Between samples the position
 * is P plus the elapsed wall time scaled by the rate. Phase 3 replaces this with
 * a clock that also slews toward corrections instead of jumping to them.
 */
let sample: { positionMs: number; sampledAtMs: number; rate: number; playing: boolean } | null =
  null;

const resolver = new LyricsResolver(new LyricsCache(cachePath));
let lyrics: Lyrics | null = null;
let lastLineIndex = -1;

/** The line whose window contains this position, or -1 before the first line. */
function lineIndexAt(positionMs: number): number {
  if (lyrics === null || lyrics.kind !== 'synced') return -1;
  for (let i = lyrics.lines.length - 1; i >= 0; i -= 1) {
    if (positionMs >= lyrics.lines[i]!.startMs) return i;
  }
  return -1;
}

function extrapolatedMs(): number {
  if (sample === null) return 0;
  return sample.positionMs + (Date.now() - sample.sampledAtMs) * sample.rate;
}

source.on('track', (track) => {
  if (track === null) {
    console.log(`\n${dim('-')} ${bold('nothing playing')}`);
    return;
  }
  const length = track.durationMs === null ? '?' : clock(track.durationMs);
  lyrics = null;
  lastLineIndex = -1;
  console.log(
    `\n${cyan('>')} ${bold(track.title)}\n` +
      `  ${track.artist || dim('(unknown artist)')}${track.album ? dim(` - ${track.album}`) : ''}\n` +
      dim(`  ${length} | ${track.bundleId ?? 'unknown app'}`) +
      (track.inferred ? dim(' | title-parsed') : '') +
      (track.artworkDataUrl ? dim(' | artwork') : '') +
      `\n  ${dim(`id: ${track.id}`)}`,
  );

  void resolver
    .resolve(track)
    .then((resolved) => {
      lyrics = resolved;
      const detail =
        resolved.kind === 'synced'
          ? `${resolved.lines.length} timed lines`
          : resolved.kind === 'plain'
            ? `${resolved.lines.length} untimed lines (static reading)`
            : 'no lyrics found (ambient mode)';
      console.log(dim(`  lyrics: ${resolved.kind} - ${detail}`) + dim(resolved.sourceId ? ` [${resolved.sourceId}]` : ''));
    })
    .catch((error: unknown) => {
      console.error(`${red('x')} lyrics: ${(error as Error).message}`);
    });
});

source.on('position', (state) => {
  // Show how far the new sample moves the clock: a large correction means the
  // previous sample was stale, which is exactly what the slew logic must absorb.
  const driftMs = sample === null ? 0 : state.positionMs - extrapolatedMs();
  sample = state;
  const drift = Math.abs(driftMs) < 1_000 ? '' : dim(` correction ${(driftMs / 1000).toFixed(1)}s`);
  console.log(
    dim(`  sample ${state.playing ? 'play' : 'paused'} ${clock(state.positionMs)}`) + drift,
  );
});

// Tick independently of samples, the way the renderer will.
const ticker = setInterval(() => {
  if (sample === null || !sample.playing) return;
  const position = extrapolatedMs();

  // Print a line only as it becomes current, which is the terminal equivalent of
  // what the renderer will do with it.
  const index = lineIndexAt(position);
  if (index !== lastLineIndex && index >= 0) {
    lastLineIndex = index;
    const text = lyrics!.lines[index]!.text;
    process.stdout.write(`\r${' '.repeat(40)}\r`);
    console.log(`  ${green(text === '' ? '(instrumental)' : text)}`);
    return;
  }
  process.stdout.write(`\r${dim(`  clock ${clock(position)}`)}   `);
}, 250);
ticker.unref();

source.on('error', (error) => console.error(`${red('x')} ${error.message}`));

const shutdown = () => {
  clearInterval(ticker);
  void source.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await source.start();
console.log(dim('watching... (ctrl-c to stop)'));
