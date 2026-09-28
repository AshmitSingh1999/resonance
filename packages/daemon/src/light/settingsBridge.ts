import type { SettingsValues } from '@resonance/shared';
import { daemonSettingIds, coerceSetting } from '@resonance/shared';
import type { LightConfig } from './config.js';

/**
 * Translation between schema ids and the daemon's config shape.
 *
 * The schema namespaces light settings (`lightUpdateHz`) while `light.json` uses
 * short field names, because it also holds device credentials that are
 * deliberately not part of the schema. One small map keeps both readable rather
 * than renaming a config file that already exists on disk.
 */
const FIELD_BY_ID: Record<string, keyof Omit<LightConfig, 'device'>> = {
  lightEnabled: 'enabled',
  lightMode: 'mode',
  lightUpdateHz: 'updateHz',
  lightMaxBrightness: 'maxBrightness',
};

/** Daemon-owned settings, as schema ids, for reporting to the page. */
export function settingsFromConfig(config: LightConfig): SettingsValues {
  const values: SettingsValues = {};
  for (const [id, field] of Object.entries(FIELD_BY_ID)) {
    values[id] = config[field] as SettingsValues[string];
  }
  return values;
}

/**
 * Apply settings from the page.
 *
 * Every value is re-validated here rather than trusted: the page is a separate
 * process that can be reloaded, downgraded or hand-edited, and an out-of-range
 * update rate would reach the bulb.
 */
export function configChangesFromSettings(
  values: SettingsValues,
): Partial<Omit<LightConfig, 'device'>> {
  const owned = new Set(daemonSettingIds());
  const changes: Record<string, unknown> = {};

  for (const [id, value] of Object.entries(values)) {
    if (!owned.has(id)) continue; // the page cannot write what it does not own
    const field = FIELD_BY_ID[id];
    if (field === undefined) continue;
    const coerced = coerceSetting(id, value);
    if (coerced !== undefined) changes[field] = coerced;
  }

  return changes as Partial<Omit<LightConfig, 'device'>>;
}
