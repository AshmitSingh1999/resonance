import {
  SETTINGS,
  SETTING_BY_ID,
  defaultValues,
  type Setting,
  type SettingsValues,
  type SettingValue,
} from './schema.js';

/**
 * Coerce one stored value against its declaration.
 *
 * Anything that is not currently valid is replaced by the default rather than
 * trusted. That covers a stored record written by an older version whose field
 * *types* have since changed — which is not hypothetical: `backdrop` was once a
 * boolean, and merging the stale value over the new default sent an unknown key
 * to the shader, silently collapsing every backdrop onto one branch.
 */
function coerce(setting: Setting, value: unknown): SettingValue {
  switch (setting.kind) {
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return setting.default;
      return Math.min(setting.max, Math.max(setting.min, value));
    }
    case 'toggle':
      return typeof value === 'boolean' ? value : setting.default;
    case 'chips': {
      if (value === null) return setting.nullable === true ? null : setting.default;
      if (typeof value !== 'string') return setting.default;
      return setting.options.some((option) => option.value === value) ? value : setting.default;
    }
  }
}

/**
 * Validate a stored settings record field by field.
 *
 * Keys absent from the schema are dropped, so a setting that is removed leaves
 * nothing behind; keys the record omits take their default, so a setting that is
 * added needs no migration.
 */
export function sanitiseSettings(raw: unknown): SettingsValues {
  if (raw === null || typeof raw !== 'object') return defaultValues();
  const stored = raw as Record<string, unknown>;

  const values: SettingsValues = {};
  for (const setting of SETTINGS) {
    values[setting.id] = Object.hasOwn(stored, setting.id)
      ? coerce(setting, stored[setting.id])
      : setting.default;
  }
  return values;
}

/** Validate a single value, for the incremental updates the UI sends. */
export function coerceSetting(id: string, value: unknown): SettingValue | undefined {
  const setting = SETTING_BY_ID.get(id);
  return setting === undefined ? undefined : coerce(setting, value);
}

/**
 * Split a record by where it is stored.
 *
 * The browser half goes to `localStorage`; the daemon half is sent over the
 * socket and written to the daemon's config, so the bulb keeps its behaviour
 * with no page open.
 */
export function splitByOwner(values: SettingsValues): {
  browser: SettingsValues;
  daemon: SettingsValues;
} {
  const browser: SettingsValues = {};
  const daemon: SettingsValues = {};
  for (const setting of SETTINGS) {
    const target = setting.owner === 'daemon' ? daemon : browser;
    if (Object.hasOwn(values, setting.id)) target[setting.id] = values[setting.id]!;
  }
  return { browser, daemon };
}
