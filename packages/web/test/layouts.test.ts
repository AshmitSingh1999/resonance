import { describe, it, expect } from 'vitest';
import { LAYOUTS, layoutById } from '../src/theme/layouts.js';

describe('layouts', () => {
  it('gives every layout sane context counts', () => {
    for (const layout of LAYOUTS) {
      expect(layout.contextBefore).toBeGreaterThanOrEqual(0);
      expect(layout.contextAfter).toBeGreaterThanOrEqual(1);
      expect(layout.contextBefore + layout.contextAfter).toBeLessThanOrEqual(8);
    }
  });

  it('gives every layout a unique id and class', () => {
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length);
    expect(new Set(LAYOUTS.map((l) => l.className)).size).toBe(LAYOUTS.length);
  });

  it('shows strictly fewer lines in band than in centred', () => {
    const band = layoutById('band');
    const centred = layoutById('centred');
    const total = (l: typeof band) => l.contextBefore + l.contextAfter;
    expect(total(band)).toBeLessThan(total(centred));
  });

  it('falls back to the default layout for an unknown id', () => {
    expect(layoutById('nonsense' as never).id).toBe('centred');
  });

  it('describes each layout for the settings panel', () => {
    for (const layout of LAYOUTS) {
      expect(layout.note.length).toBeGreaterThan(8);
    }
  });
});
