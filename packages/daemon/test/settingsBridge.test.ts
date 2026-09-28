import { describe, it, expect } from 'vitest';
import { settingsFromConfig, configChangesFromSettings } from '../src/light/settingsBridge.js';
import { DEFAULT_LIGHT_CONFIG } from '../src/light/config.js';

describe('settingsFromConfig', () => {
  it('reports the daemon-owned settings by schema id', () => {
    expect(settingsFromConfig({ ...DEFAULT_LIGHT_CONFIG, updateHz: 12 })).toMatchObject({
      lightEnabled: false,
      lightMode: 'palette',
      lightUpdateHz: 12,
      lightMaxBrightness: 0.9,
    });
  });

  it('never includes device credentials', () => {
    const values = settingsFromConfig({
      ...DEFAULT_LIGHT_CONFIG,
      device: { id: 'abc', key: 'secret', ip: '10.0.0.1', version: '3.5' },
    });
    expect(JSON.stringify(values)).not.toContain('secret');
    expect(JSON.stringify(values)).not.toContain('10.0.0.1');
  });
});

describe('configChangesFromSettings', () => {
  it('maps schema ids onto config fields', () => {
    expect(configChangesFromSettings({ lightUpdateHz: 15 })).toEqual({ updateHz: 15 });
    expect(configChangesFromSettings({ lightEnabled: true })).toEqual({ enabled: true });
  });

  it('ignores settings the daemon does not own', () => {
    // The page must not be able to write daemon state through this channel just
    // by naming a key.
    expect(configChangesFromSettings({ layout: 'band', showMeters: true })).toEqual({});
  });

  it('re-validates rather than trusting the page', () => {
    // The browser is a separate process that can be reloaded or hand-edited, and
    // an out-of-range rate would reach the bulb.
    expect(configChangesFromSettings({ lightUpdateHz: 9999 })).toEqual({ updateHz: 50 });
    expect(configChangesFromSettings({ lightMaxBrightness: -3 })).toEqual({ maxBrightness: 0.05 });
    expect(configChangesFromSettings({ lightMode: 'disco' })).toEqual({ mode: 'palette' });
  });

  it('drops values of the wrong type', () => {
    expect(configChangesFromSettings({ lightEnabled: 'yes' })).toEqual({ enabled: false });
  });

  it('returns nothing for an empty update', () => {
    expect(configChangesFromSettings({})).toEqual({});
  });

  it('round-trips through the config shape', () => {
    const changes = configChangesFromSettings(
      settingsFromConfig({ ...DEFAULT_LIGHT_CONFIG, updateHz: 20, enabled: true }),
    );
    expect(changes).toMatchObject({ updateHz: 20, enabled: true });
  });
});
