import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** packages/daemon/src -> repository root. */
const repoRoot = resolve(here, '..', '..', '..');

export const adapterScriptPath = resolve(
  repoRoot,
  'vendor/mediaremote-adapter/bin/mediaremote-adapter.pl',
);
export const adapterFrameworkPath = resolve(
  repoRoot,
  'vendor/mediaremote-adapter/build/MediaRemoteAdapter.framework',
);

/**
 * Fail loudly and with a fix, rather than surfacing a confusing spawn error.
 *
 * The framework is a build artifact, so a fresh clone will not have it.
 */
export function assertAdapterBuilt(): void {
  const missing = [adapterScriptPath, adapterFrameworkPath].filter((p) => !existsSync(p));
  if (missing.length === 0) return;
  throw new Error(
    `MediaRemote adapter is not built. Missing:\n  ${missing.join('\n  ')}\n\n` +
      'Build it with:\n' +
      '  cd vendor/mediaremote-adapter && mkdir -p build && cd build && cmake .. && cmake --build .',
  );
}

/** Where the lyrics cache lives. Kept out of the repo, alongside other app data. */
export const cachePath = resolve(repoRoot, '.resonance/lyrics.db');

/** Built web assets, served directly once `npm run build` has produced them. */
export const webDistPath = resolve(repoRoot, 'packages/web/dist');

/** The native system-audio helper, built by `native/resonance-audio/build.sh`. */
export const audioHelperPath = resolve(repoRoot, 'native/resonance-audio/build/resonance-audio');

/** Bulb configuration, written by `scripts/tuya-setup.sh`. */
export const lightConfigPath = resolve(repoRoot, '.resonance/light.json');

/** Python interpreter in the virtualenv the setup script creates. */
export const tuyaPythonPath = resolve(repoRoot, '.resonance/tuya-venv/bin/python');

/** The bulb bridge script. */
export const tuyaBridgePath = resolve(repoRoot, 'bridges/tuya-bulb/bridge.py');
