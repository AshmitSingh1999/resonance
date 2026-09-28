import { describe, it, expect } from 'vitest';
import { mergePayload, toTrack, toPlaybackState } from '../src/nowplaying/payload.js';

const snapshot = (payload: Record<string, unknown>) => ({ type: 'data', diff: false, payload });
const diff = (payload: Record<string, unknown>) => ({ type: 'data', diff: true, payload });

describe('mergePayload', () => {
  it('replaces state wholesale on a non-diff snapshot', () => {
    expect(mergePayload({ a: 1, b: 2 }, snapshot({ c: 3 }))).toEqual({ c: 3 });
  });

  it('tolerates the empty payload the adapter emits first', () => {
    // The stream opens with {"diff":false,"payload":{}} before any real data.
    expect(mergePayload({ a: 1 }, snapshot({}))).toEqual({});
  });

  it('merges changed keys on a diff', () => {
    expect(mergePayload({ a: 1, b: 2 }, diff({ b: 99 }))).toEqual({ a: 1, b: 99 });
  });

  it('deletes a key when a diff reports it as null', () => {
    expect(mergePayload({ a: 1, b: 2 }, diff({ b: null }))).toEqual({ a: 1 });
  });

  it('does not mutate the previous state', () => {
    const prev = { a: 1 };
    mergePayload(prev, diff({ a: 2, b: 3 }));
    expect(prev).toEqual({ a: 1 });
  });
});

describe('toTrack', () => {
  const spotify = {
    title: 'Lioness - Francis Mercier Remix',
    artist: 'Swedish House Mafia',
    album: 'Lioness (Francis Mercier Remix)',
    duration: 193.279,
    bundleIdentifier: 'com.spotify.client',
  };

  it('maps a structured player payload directly', () => {
    const t = toTrack(spotify)!;
    expect(t).toMatchObject({
      title: 'Lioness - Francis Mercier Remix',
      artist: 'Swedish House Mafia',
      durationMs: 193_279,
      inferred: false,
    });
  });

  it('returns null when there is no title', () => {
    expect(toTrack({})).toBeNull();
    expect(toTrack({ title: '   ' })).toBeNull();
  });

  it('builds a data URL from artwork bytes and mime type', () => {
    const t = toTrack({ ...spotify, artworkData: 'QUJD', artworkMimeType: 'image/png' })!;
    expect(t.artworkDataUrl).toBe('data:image/png;base64,QUJD');
  });

  it('defaults the artwork mime type when the player omits it', () => {
    const t = toTrack({ ...spotify, artworkData: 'QUJD' })!;
    expect(t.artworkDataUrl).toBe('data:image/jpeg;base64,QUJD');
  });

  it('leaves artworkDataUrl null when there is no artwork', () => {
    expect(toTrack(spotify)!.artworkDataUrl).toBeNull();
  });

  it('parses a browser page title into artist and title, flagged inferred', () => {
    const t = toTrack({
      title: 'Adele - Hello (Official Music Video)',
      bundleIdentifier: 'com.google.Chrome',
      duration: 295,
    })!;
    expect(t).toMatchObject({ artist: 'Adele', title: 'Hello', inferred: true });
  });

  it('does not second-guess a browser that supplies a real artist field', () => {
    const t = toTrack({
      title: 'Hello',
      artist: 'Adele',
      bundleIdentifier: 'com.google.Chrome',
    })!;
    expect(t).toMatchObject({ artist: 'Adele', title: 'Hello', inferred: false });
  });

  it('does not apply title parsing to native players', () => {
    // A real song legitimately titled "A - B" must survive intact in Spotify.
    const t = toTrack({ title: 'A - B', bundleIdentifier: 'com.spotify.client' })!;
    expect(t).toMatchObject({ title: 'A - B', artist: '', inferred: false });
  });
});

describe('toPlaybackState', () => {
  it('uses the adapter timestamp as the sample instant, not parse time', () => {
    const s = toPlaybackState(
      { elapsedTime: 12.5, playing: true, playbackRate: 1, timestamp: '2026-09-21T07:35:47Z' },
      999,
    )!;
    expect(s).toEqual({
      playing: true,
      positionMs: 12_500,
      sampledAtMs: Date.parse('2026-09-21T07:35:47Z'),
      rate: 1,
    });
  });

  it('falls back to the supplied instant when the timestamp is missing or bad', () => {
    expect(toPlaybackState({ elapsedTime: 1, playing: true }, 999)!.sampledAtMs).toBe(999);
    expect(toPlaybackState({ elapsedTime: 1, timestamp: 'nonsense' }, 999)!.sampledAtMs).toBe(999);
  });

  it('reports rate 0 when paused so extrapolation freezes', () => {
    const s = toPlaybackState({ elapsedTime: 30, playing: false, playbackRate: 1 }, 0)!;
    expect(s).toMatchObject({ playing: false, rate: 0 });
  });

  it('returns null when the payload carries no position at all', () => {
    expect(toPlaybackState({ playing: true }, 0)).toBeNull();
  });

  it('accepts a zero elapsed time rather than treating it as absent', () => {
    expect(toPlaybackState({ elapsedTime: 0, playing: true }, 0)!.positionMs).toBe(0);
  });
});
