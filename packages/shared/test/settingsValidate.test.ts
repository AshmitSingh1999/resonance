import { describe, it, expect } from 'vitest';
import { sanitiseSettings, splitByOwner } from '../src/settings/validate.js';
import { defaultValues, SETTINGS, SETTING_BY_ID } from '../src/settings/schema.js';

describe('sanitiseSettings', () => {
  it('returns defaults for a missing or malformed record', () => {
    expect(sanitiseSettings(null)).toEqual(defaultValues());
    expect(sanitiseSettings('nonsense')).toEqual(defaultValues());
    expect(sanitiseSettings(42)).toEqual(defaultValues());
  });

  it('fills in settings a stored record does not mention', () => {
    const result = sanitiseSettings({ showMeters: true });
    expect(result['showMeters']).toBe(true);
    expect(result['layout']).toBe('centred');
  });

  it('drops keys that are not in the schema', () => {
    const result = sanitiseSettings({ showMeters: true, ancientSetting: 'x' });
    expect(result).not.toHaveProperty('ancientSetting');
  });

  it('clamps a range to its declared bounds', () => {
    expect(sanitiseSettings({ lightUpdateHz: 9999 })['lightUpdateHz']).toBe(50);
    expect(sanitiseSettings({ lightUpdateHz: -5 })['lightUpdateHz']).toBe(1);
  });

  it('replaces a non-finite range value with its default', () => {
    expect(sanitiseSettings({ offsetMs: Number.NaN })['offsetMs']).toBe(0);
    expect(sanitiseSettings({ offsetMs: Number.POSITIVE_INFINITY })['offsetMs']).toBe(0);
  });

  it('rejects a chips value that is not one of the options', () => {
    expect(sanitiseSettings({ layout: 'spiral' })['layout']).toBe('centred');
    expect(sanitiseSettings({ lightMode: 'disco' })['lightMode']).toBe('palette');
  });

  it('keeps a valid chips value', () => {
    expect(sanitiseSettings({ layout: 'band' })['layout']).toBe('band');
  });

  it('allows null only where the setting is nullable', () => {
    // `family` is nullable — null means "decide automatically".
    expect(sanitiseSettings({ family: null })['family']).toBeNull();
    // `layout` is not, so null falls back rather than disabling the control.
    expect(sanitiseSettings({ layout: null })['layout']).toBe('centred');
  });

  it('discards a stored value whose type no longer matches the schema', () => {
    // The regression that motivated generating this: `backdrop` was once a
    // boolean. Merged blindly, the stale `true` reached the shader as an unknown
    // key and silently collapsed every backdrop onto one branch.
    expect(sanitiseSettings({ backdrop: true })['backdrop']).toBe('auto');
    expect(sanitiseSettings({ backdropEnabled: 'yes' })['backdropEnabled']).toBe(true);
    expect(sanitiseSettings({ offsetMs: 'late' })['offsetMs']).toBe(0);
    expect(sanitiseSettings({ showMeters: 1 })['showMeters']).toBe(false);
  });

  it('produces a record valid against the schema for any garbage input', () => {
    const noisy = sanitiseSettings({
      family: 12, layout: [], scheme: {}, backdrop: false,
      offsetMs: 'x', lightUpdateHz: null, lightMaxBrightness: 'bright',
    });
    for (const setting of SETTINGS) {
      const value = noisy[setting.id];
      if (setting.kind === 'range') {
        expect(typeof value).toBe('number');
        expect(value as number).toBeGreaterThanOrEqual(setting.min);
        expect(value as number).toBeLessThanOrEqual(setting.max);
      } else if (setting.kind === 'toggle') {
        expect(typeof value).toBe('boolean');
      } else {
        const allowed = setting.options.map((o) => o.value);
        expect(value === null || allowed.includes(value as string)).toBe(true);
      }
    }
  });

  it('is idempotent', () => {
    const once = sanitiseSettings({ layout: 'band', lightUpdateHz: 99 });
    expect(sanitiseSettings(once)).toEqual(once);
  });
});

describe('splitByOwner', () => {
  it('separates daemon-owned settings from browser ones', () => {
    const { browser, daemon } = splitByOwner(defaultValues());
    expect(Object.keys(daemon)).toContain('lightUpdateHz');
    expect(Object.keys(daemon)).not.toContain('layout');
    expect(Object.keys(browser)).toContain('layout');
    expect(Object.keys(browser)).not.toContain('lightUpdateHz');
  });

  it('together accounts for every setting, losing none', () => {
    const { browser, daemon } = splitByOwner(defaultValues());
    expect(Object.keys(browser).length + Object.keys(daemon).length).toBe(SETTINGS.length);
  });
});

describe('the schema itself', () => {
  it('gives every setting a unique id', () => {
    expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length);
    expect(SETTING_BY_ID.size).toBe(SETTINGS.length);
  });

  it('gives every range a default inside its own bounds', () => {
    for (const setting of SETTINGS) {
      if (setting.kind !== 'range') continue;
      expect(setting.default).toBeGreaterThanOrEqual(setting.min);
      expect(setting.default).toBeLessThanOrEqual(setting.max);
      expect(setting.step).toBeGreaterThan(0);
    }
  });

  it('gives every chips setting a default that is an option, or null when nullable', () => {
    for (const setting of SETTINGS) {
      if (setting.kind !== 'chips') continue;
      if (setting.default === null) {
        expect(setting.nullable).toBe(true);
      } else {
        expect(setting.options.map((o) => o.value)).toContain(setting.default);
      }
    }
  });

  it('gives every setting a label', () => {
    for (const setting of SETTINGS) expect(setting.label.length).toBeGreaterThan(2);
  });
});
