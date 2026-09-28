import { describe, it, expect } from 'vitest';
import { SyncClock, MAX_SLEW_RATE, JUMP_THRESHOLD_MS } from '../src/sync/clock.js';

const playing = (positionMs: number, atMs: number) => ({
  playing: true,
  positionMs,
  sampledAtMs: atMs,
  rate: 1,
});

describe('SyncClock', () => {
  it('reports zero before any sample arrives', () => {
    expect(new SyncClock().positionAt(1000)).toBe(0);
  });

  it('extrapolates forward from a sample at the playback rate', () => {
    const clock = new SyncClock();
    clock.applySample(playing(10_000, 1000));
    expect(clock.positionAt(3000)).toBe(12_000);
  });

  it('freezes while paused', () => {
    const clock = new SyncClock();
    clock.applySample({ playing: false, positionMs: 10_000, sampledAtMs: 1000, rate: 0 });
    expect(clock.positionAt(9000)).toBe(10_000);
  });

  it('adopts the first sample exactly, with no slew', () => {
    const clock = new SyncClock();
    clock.applySample(playing(60_000, 0));
    expect(clock.positionAt(0)).toBe(60_000);
  });

  it('does not jump to a small correction, but eases toward it', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    // At t=1000 the clock reads 1000. A sample says it is really 1200.
    clock.applySample(playing(1200, 1000));

    const immediately = clock.positionAt(1000);
    expect(immediately).toBeLessThan(1200);
    expect(immediately).toBeGreaterThanOrEqual(1000);
  });

  it('completes a slew and then tracks the corrected timeline', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(1200, 1000));

    // 200ms of correction at the bounded rate takes 200/0.5 = 400ms.
    expect(clock.positionAt(1400)).toBeCloseTo(1600, 0);
    expect(clock.positionAt(2400)).toBeCloseTo(2600, 0);
  });

  it('never runs backwards while correcting a clock that is ahead', () => {
    // Lyrics jumping back a line reads as a bug, so the slew rate is bounded
    // below the playback rate rather than being spread over a fixed window.
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(500, 1000)); // we are 500ms ahead of the truth

    let previous = clock.positionAt(1000);
    for (let t = 1000; t <= 3000; t += 50) {
      const current = clock.positionAt(t);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('bounds the slew rate so playback never visibly stalls or races', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(900, 1000));

    const rate = (clock.positionAt(1200) - clock.positionAt(1100)) / 100;
    expect(rate).toBeGreaterThanOrEqual(1 - MAX_SLEW_RATE - 0.001);
    expect(rate).toBeLessThanOrEqual(1 + MAX_SLEW_RATE + 0.001);
  });

  it('jumps rather than slews when the correction is a real seek', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(120_000, 1000));
    expect(clock.positionAt(1000)).toBe(120_000);
  });

  it('treats a correction just past the threshold as a seek', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(1000 + JUMP_THRESHOLD_MS + 1, 1000));
    expect(clock.positionAt(1000)).toBe(1000 + JUMP_THRESHOLD_MS + 1);
  });

  it('applies the user latency offset on read', () => {
    const clock = new SyncClock();
    clock.applySample(playing(10_000, 0));
    clock.offsetMs = 250;
    expect(clock.positionAt(0)).toBe(10_250);
  });

  it('accepts a negative offset for output that runs ahead', () => {
    const clock = new SyncClock();
    clock.applySample(playing(10_000, 0));
    clock.offsetMs = -250;
    expect(clock.positionAt(0)).toBe(9750);
  });

  it('never reports a negative position', () => {
    const clock = new SyncClock();
    clock.applySample(playing(100, 0));
    clock.offsetMs = -5000;
    expect(clock.positionAt(0)).toBe(0);
  });

  it('abandons an in-flight slew when a seek arrives', () => {
    const clock = new SyncClock();
    clock.applySample(playing(0, 0));
    clock.applySample(playing(1200, 1000)); // starts a slew
    clock.applySample(playing(90_000, 1100)); // then a seek
    expect(clock.positionAt(1100)).toBe(90_000);
  });

  it('resets cleanly for a new track', () => {
    const clock = new SyncClock();
    clock.applySample(playing(200_000, 0));
    clock.reset();
    expect(clock.positionAt(5000)).toBe(0);
  });
});
