import { describe, it, expect } from 'vitest';
import { sanitiseLightConfig, DEFAULT_LIGHT_CONFIG } from '../src/light/config.js';

const device = { id: 'abc', key: 'xyz', ip: '192.168.1.5', version: '3.4' };

describe('sanitiseLightConfig', () => {
  it('returns defaults for a missing or malformed file', () => {
    expect(sanitiseLightConfig(null)).toEqual(DEFAULT_LIGHT_CONFIG);
    expect(sanitiseLightConfig('nonsense')).toEqual(DEFAULT_LIGHT_CONFIG);
  });

  it('keeps a complete device', () => {
    expect(sanitiseLightConfig({ device }).device).toEqual(device);
  });

  it('rejects a partial device rather than half-configuring the bridge', () => {
    expect(sanitiseLightConfig({ device: { id: 'abc' } }).device).toBeNull();
    expect(sanitiseLightConfig({ device: { id: 'abc', key: 'xyz' } }).device).toBeNull();
  });

  it('defaults the protocol version when absent', () => {
    const { device: parsed } = sanitiseLightConfig({ device: { id: 'a', key: 'b', ip: 'c' } });
    expect(parsed?.version).toBe('3.3');
  });

  it('clamps the update rate to the exploration ceiling', () => {
    // 50 is deliberately above what the measured hardware sustains (~20/sec on
    // the bulb tested): the point is to let the real limit be found by eye,
    // while flow control stops an unachievable rate building a backlog.
    expect(sanitiseLightConfig({ updateHz: 500 }).updateHz).toBe(50);
    expect(sanitiseLightConfig({ updateHz: 0 }).updateHz).toBe(1);
    expect(sanitiseLightConfig({ updateHz: 'fast' }).updateHz).toBe(DEFAULT_LIGHT_CONFIG.updateHz);
  });

  it('clamps brightness, never to fully dark', () => {
    expect(sanitiseLightConfig({ maxBrightness: 9 }).maxBrightness).toBe(1);
    expect(sanitiseLightConfig({ maxBrightness: 0 }).maxBrightness).toBe(0.05);
  });

  it('only accepts the two known modes', () => {
    expect(sanitiseLightConfig({ mode: 'spectrum' }).mode).toBe('spectrum');
    expect(sanitiseLightConfig({ mode: 'disco' }).mode).toBe('palette');
  });

  it('defaults to disabled, so a fresh install never drives a light unasked', () => {
    expect(sanitiseLightConfig({}).enabled).toBe(false);
  });
});
