import { describe, it, expect } from 'vitest';
import { parseProbeOutput, isScriptable } from '../src/nowplaying/positionProbe.js';

describe('parseProbeOutput', () => {
  it('reads Spotify, whose position is seconds but duration is milliseconds', () => {
    // Regression guard for a real inconsistency in Spotify's AppleScript API.
    expect(parseProbeOutput('playing|18.611999511719|299723', 'milliseconds')).toEqual({
      state: 'playing',
      positionMs: 18_612,
      durationMs: 299_723,
    });
  });

  it('reads Apple Music, whose duration is seconds', () => {
    expect(parseProbeOutput('playing|30.5|245.8', 'seconds')).toEqual({
      state: 'playing',
      positionMs: 30_500,
      durationMs: 245_800,
    });
  });

  it('recognises the paused state', () => {
    expect(parseProbeOutput('paused|10|100', 'seconds')!.state).toBe('paused');
  });

  it('maps any unfamiliar state to stopped rather than guessing', () => {
    expect(parseProbeOutput('missing value|0|0', 'seconds')!.state).toBe('stopped');
  });

  it('returns null on a malformed reading', () => {
    expect(parseProbeOutput('', 'seconds')).toBeNull();
    expect(parseProbeOutput('playing|10', 'seconds')).toBeNull();
    expect(parseProbeOutput('playing|abc|100', 'seconds')).toBeNull();
  });

  it('tolerates a missing duration without discarding a good position', () => {
    const r = parseProbeOutput('playing|12.5|missing value', 'seconds')!;
    expect(r).toMatchObject({ positionMs: 12_500, durationMs: null });
  });

  it('ignores trailing whitespace from osascript output', () => {
    expect(parseProbeOutput('playing|1|2\n', 'seconds')!.positionMs).toBe(1000);
  });
});

describe('isScriptable', () => {
  it('knows the players that expose an exact position', () => {
    expect(isScriptable('com.spotify.client')).toBe(true);
    expect(isScriptable('com.apple.Music')).toBe(true);
  });

  it('reports browsers as not scriptable, so they fall back to extrapolation', () => {
    expect(isScriptable('com.google.Chrome')).toBe(false);
    expect(isScriptable(null)).toBe(false);
  });
});
