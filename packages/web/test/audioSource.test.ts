import { describe, it, expect } from 'vitest';
import { NativeAudioSource, SilentAudioSource, tapStateForNative } from '../src/audio/source.js';

const frame = (over = {}) => ({
  bass: 0.5, mid: 0.4, treble: 0.3, rms: 0.6, centroid: 0.2, onset: false, ...over,
});

describe('tapStateForNative', () => {
  it('maps live capture to listening', () => {
    expect(tapStateForNative('live')).toEqual({ status: 'listening' });
  });

  it('explains a denied permission rather than showing nothing', () => {
    expect(tapStateForNative('denied')).toMatchObject({ status: 'unavailable' });
  });

  it('keeps the helper-specific reason when one is given', () => {
    expect(tapStateForNative('unsupported', 'helper not built')).toEqual({
      status: 'unavailable',
      reason: 'helper not built',
    });
  });

  it('treats an idle daemon as idle, not as an error', () => {
    expect(tapStateForNative('off')).toEqual({ status: 'idle' });
  });
});

describe('NativeAudioSource', () => {
  it('returns silence before any frame arrives', () => {
    expect(new NativeAudioSource().read()).toMatchObject({ rms: 0, onset: false });
  });

  it('returns the latest frame once receiving', () => {
    const source = new NativeAudioSource();
    source.acceptFrame(frame());
    expect(source.read()).toMatchObject({ bass: 0.5, rms: 0.6 });
  });

  it('reports listening as soon as frames arrive', () => {
    const source = new NativeAudioSource();
    source.acceptFrame(frame());
    expect(source.state.status).toBe('listening');
  });

  it('reports an onset exactly once, however often it is read', () => {
    // Frames arrive at ~30Hz while the renderer reads at 60, so an unlatched
    // onset would trigger the beat animation twice and read as a stutter.
    const source = new NativeAudioSource();
    source.acceptFrame(frame({ onset: true }));
    expect(source.read().onset).toBe(true);
    expect(source.read().onset).toBe(false);
    expect(source.read().onset).toBe(false);
  });

  it('carries a later onset through after an earlier one was consumed', () => {
    const source = new NativeAudioSource();
    source.acceptFrame(frame({ onset: true }));
    source.read();
    source.acceptFrame(frame({ onset: true }));
    expect(source.read().onset).toBe(true);
  });

  it('returns silence when the daemon reports capture stopped', () => {
    const source = new NativeAudioSource();
    source.acceptFrame(frame());
    source.acceptState('denied');
    expect(source.read()).toMatchObject({ rms: 0, onset: false });
  });

  it('clears its latest frame on stop', () => {
    const source = new NativeAudioSource();
    source.acceptFrame(frame());
    source.stop();
    expect(source.read().rms).toBe(0);
  });
});

describe('SilentAudioSource', () => {
  it('always reads silence, so callers need no null handling', () => {
    const source = new SilentAudioSource();
    expect(source.read()).toMatchObject({ rms: 0, bass: 0, onset: false });
    expect(source.state.status).toBe('idle');
  });
});
