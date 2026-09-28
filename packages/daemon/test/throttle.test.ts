import { describe, it, expect } from 'vitest';
import { ColourThrottle } from '../src/light/throttle.js';

const hsv = (h: number, s = 900, v = 600) => ({ h, s, v });

describe('ColourThrottle', () => {
  it('sends the first colour immediately', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    expect(throttle.offer(hsv(10), 1000)).toBe(true);
  });

  it('refuses a second colour before the interval has passed', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(10), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(200), 1050)).toBe(false);
  });

  it('accepts again once the interval has passed', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(10), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(200), 1130)).toBe(true);
  });

  it('refuses while a write is still in flight, however long it takes', () => {
    // Never queue: a slow bulb must not build a backlog, or the light drifts
    // further behind the music the busier the track gets.
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(10), 1000);
    expect(throttle.offer(hsv(200), 5000)).toBe(false);
  });

  it('resumes as soon as the write completes', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(10), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(200), 2000)).toBe(true);
  });

  it('is not wedged permanently by a failed write', () => {
    // A bulb that goes offline mid-write must not stop the light forever once
    // it comes back.
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(10), 1000);
    throttle.fail();
    expect(throttle.offer(hsv(200), 2000)).toBe(true);
  });

  it('suppresses changes too small to see', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125, epsilon: 20 });
    throttle.offer(hsv(100, 900, 600), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(103, 905, 604), 2000)).toBe(false);
  });

  it('accepts a change that crosses the threshold', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125, epsilon: 20 });
    throttle.offer(hsv(100, 900, 600), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(100, 900, 700), 2000)).toBe(true);
  });

  it('treats hue as circular, so reds near the wrap are not a huge jump', () => {
    // Numerically |359 - 2| is 357, but they are three degrees apart. Without
    // circular distance a colour hovering around red would send on every frame.
    const throttle = new ColourThrottle({ minIntervalMs: 125, epsilon: 20 });
    throttle.offer(hsv(359, 900, 600), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(2, 900, 600), 2000)).toBe(false);
  });

  it('still notices a genuine hue change', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125, epsilon: 20 });
    throttle.offer(hsv(0, 900, 600), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(180, 900, 600), 2000)).toBe(true);
  });

  it('honours a changed interval, so the setting takes effect live', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 500 });
    throttle.offer(hsv(10), 1000);
    throttle.complete();
    expect(throttle.offer(hsv(200), 1200)).toBe(false);
    throttle.setMinInterval(100);
    expect(throttle.offer(hsv(200), 1200)).toBe(true);
  });

  it('reports what it last sent, for status and for resend after reconnect', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125 });
    throttle.offer(hsv(42), 1000);
    expect(throttle.lastSent?.h).toBe(42);
  });

  it('forgets its last colour on reset, so a reconnect repaints', () => {
    const throttle = new ColourThrottle({ minIntervalMs: 125, epsilon: 20 });
    throttle.offer(hsv(100), 1000);
    throttle.complete();
    throttle.reset();
    expect(throttle.offer(hsv(100), 1010)).toBe(true);
  });
});
