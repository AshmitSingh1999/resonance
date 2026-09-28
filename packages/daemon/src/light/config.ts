import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LightMode } from '@resonance/shared';

export interface LightDevice {
  id: string;
  key: string;
  ip: string;
  version: string;
}

export interface LightConfig {
  enabled: boolean;
  mode: LightMode;
  /** Writes per second. The device's real ceiling is lower than you would hope. */
  updateHz: number;
  /** Ceiling on brightness, 0..1. */
  maxBrightness: number;
  device: LightDevice | null;
}

export const DEFAULT_LIGHT_CONFIG: LightConfig = {
  enabled: false,
  mode: 'palette',
  updateHz: 8,
  maxBrightness: 0.9,
  device: null,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * Validate a stored config field by field.
 *
 * The same discipline the browser preferences use: a value that is not currently
 * valid is replaced rather than trusted, so a hand-edited or outdated file
 * degrades to defaults instead of reaching the device as nonsense.
 */
export function sanitiseLightConfig(raw: unknown): LightConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_LIGHT_CONFIG };
  const stored = raw as Record<string, unknown>;
  const device = stored['device'] as Record<string, unknown> | undefined;

  const hasDevice =
    device !== undefined &&
    typeof device['id'] === 'string' &&
    typeof device['key'] === 'string' &&
    typeof device['ip'] === 'string';

  return {
    enabled: typeof stored['enabled'] === 'boolean' ? stored['enabled'] : false,
    mode: stored['mode'] === 'spectrum' ? 'spectrum' : 'palette',
    // Measured on a Wipro 12.5W (Tuya v3.5): each write costs ~13ms client-side,
    // so ~20/sec is the practical ceiling before the writer itself is the limit,
    // and sustained bursts made the bulb stop answering. The cap is 50 so the
    // limit can be explored, with flow control to stop a backlog forming.
    updateHz: clamp(stored['updateHz'], 1, 50, DEFAULT_LIGHT_CONFIG.updateHz),
    maxBrightness: clamp(stored['maxBrightness'], 0.05, 1, DEFAULT_LIGHT_CONFIG.maxBrightness),
    device: hasDevice
      ? {
          id: device!['id'] as string,
          key: device!['key'] as string,
          ip: device!['ip'] as string,
          version: typeof device!['version'] === 'string' ? (device!['version'] as string) : '3.3',
        }
      : null,
  };
}

export function loadLightConfig(path: string): LightConfig {
  try {
    if (!existsSync(path)) return { ...DEFAULT_LIGHT_CONFIG };
    return sanitiseLightConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { ...DEFAULT_LIGHT_CONFIG };
  }
}

/** Persist behavioural settings, preserving the device credentials already stored. */
export function saveLightConfig(path: string, config: LightConfig): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  } catch {
    // A read-only checkout should not stop the light working for this session.
  }
}
