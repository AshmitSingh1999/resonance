import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PlaybackState } from '@resonance/shared';

const execFileAsync = promisify(execFile);

/**
 * A scriptable player we can ask for an exact current position.
 *
 * Spotify and Apple Music both expose `player position` over AppleScript, which
 * returns ground truth at the moment of the call. That is strictly better than
 * extrapolating from the last value the player pushed to MediaRemote, and it is
 * the only reliable position channel available: this adapter build's `get`
 * command returns an empty payload even while a track is playing, so polling it
 * is not an option.
 */
interface ScriptableApp {
  bundleId: string;
  appName: string;
  /** Units differ between apps, so each declares how to read its duration. */
  durationUnit: 'seconds' | 'milliseconds';
}

const SCRIPTABLE: ScriptableApp[] = [
  // Spotify reports position in seconds but track duration in milliseconds.
  { bundleId: 'com.spotify.client', appName: 'Spotify', durationUnit: 'milliseconds' },
  { bundleId: 'com.apple.Music', appName: 'Music', durationUnit: 'seconds' },
];

export interface ProbeReading {
  state: 'playing' | 'paused' | 'stopped';
  positionMs: number;
  durationMs: number | null;
}

/**
 * Parse the `state|position|duration` triple an AppleScript probe prints.
 *
 * Kept separate from the subprocess call so the unit handling — including
 * Spotify's seconds-for-position, milliseconds-for-duration inconsistency — can
 * be tested without a running music app.
 */
export function parseProbeOutput(
  raw: string,
  durationUnit: ScriptableApp['durationUnit'],
): ProbeReading | null {
  const parts = raw.trim().split('|');
  if (parts.length < 3) return null;

  const [stateRaw, positionRaw, durationRaw] = parts as [string, string, string];
  const state =
    stateRaw.trim() === 'playing' ? 'playing' : stateRaw.trim() === 'paused' ? 'paused' : 'stopped';

  const positionSeconds = Number(positionRaw);
  if (!Number.isFinite(positionSeconds)) return null;

  const durationValue = Number(durationRaw);
  const durationMs = !Number.isFinite(durationValue)
    ? null
    : durationUnit === 'milliseconds'
      ? Math.round(durationValue)
      : Math.round(durationValue * 1000);

  return { state, positionMs: Math.round(positionSeconds * 1000), durationMs };
}

/** True when this player can be asked for an exact position. */
export function isScriptable(bundleId: string | null): boolean {
  return SCRIPTABLE.some((app) => app.bundleId === bundleId);
}

/**
 * Ask a scriptable player where it currently is.
 *
 * Returns null when the app is not scriptable, is not running, or reports no
 * track — every one of which is an ordinary condition rather than an error, so
 * the caller simply falls back to extrapolation.
 */
export async function probePosition(bundleId: string | null): Promise<PlaybackState | null> {
  const app = SCRIPTABLE.find((candidate) => candidate.bundleId === bundleId);
  if (!app) return null;

  // Guard on `running`, or asking would launch the app.
  const script =
    `if application "${app.appName}" is not running then return "stopped|0|0"\n` +
    `tell application "${app.appName}"\n` +
    `  if player state is stopped then return "stopped|0|0"\n` +
    `  return (player state as text) & "|" & (player position as text) & "|" & ` +
    `(duration of current track as text)\n` +
    `end tell`;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2_000 }));
  } catch {
    // Automation permission not granted yet, or the app quit mid-call.
    return null;
  }

  const reading = parseProbeOutput(stdout, app.durationUnit);
  if (reading === null || reading.state === 'stopped') return null;

  const playing = reading.state === 'playing';
  return {
    playing,
    positionMs: reading.positionMs,
    // The reading is true as of now: no extrapolation, so no accumulated error.
    sampledAtMs: Date.now(),
    rate: playing ? 1 : 0,
  };
}
