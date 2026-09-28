import type { AudioFrame, Hsv, LightMode } from '@resonance/shared';
import { hexToRgb, rgbToHsv } from '@resonance/shared';

/**
 * Dimmest the bulb goes while the feature is running, on the device's 0..1000
 * scale. A light that blinks out between tracks reads as broken rather than as
 * responsive, so silence dims rather than extinguishes.
 */
export const DIM_FLOOR = 60;

/** Hue range used in spectrum mode: warm for bass-heavy, cool for bright. */
const WARM_HUE = 15;
const COOL_HUE = 260;

/** How much a beat lifts brightness, before the ceiling is applied. */
const ONSET_LIFT = 0.25;

export interface MappingOptions {
  /** Ceiling on brightness, 0..1. */
  maxBrightness: number;
}

export interface LightPalette {
  accent: string;
  background: string;
}

/**
 * Turn an audio frame into a colour for the bulb.
 *
 * Two modes, and the difference is about how often the colour changes rather
 * than how it is computed. In palette mode the hue belongs to the *track* — taken
 * from the album artwork the page sends — and only brightness follows the audio,
 * which is far easier to sit in a room with. Spectrum mode repaints continuously
 * from the sound itself, which is livelier and more restless.
 */
export function mapToColour(
  audio: AudioFrame,
  mode: LightMode,
  palette: LightPalette | null,
  options: MappingOptions,
): Hsv {
  const level = Math.min(1, Math.max(0, audio.rms)) + (audio.onset ? ONSET_LIFT : 0);
  const ceiling = Math.min(1, Math.max(0, options.maxBrightness));
  const v = Math.min(1000 * ceiling, Math.max(DIM_FLOOR, level * 1000 * ceiling));

  const accentHsv = mode === 'palette' && palette !== null ? accentToHsv(palette.accent) : null;

  if (accentHsv !== null) {
    return {
      h: accentHsv.h,
      // A floor on saturation keeps a near-grey cover from producing plain white,
      // which would make the bulb look broken rather than tastefully neutral.
      s: Math.min(1000, Math.max(350, accentHsv.s * 1000)),
      v,
    };
  }

  const centroid = Math.min(1, Math.max(0, audio.centroid));
  return {
    h: WARM_HUE + centroid * (COOL_HUE - WARM_HUE),
    s: 900,
    v,
  };
}

/** Hue and saturation of a palette accent, or null if it is not a hex colour. */
function accentToHsv(accent: string): { h: number; s: number } | null {
  const rgb = hexToRgb(accent);
  if (rgb === null) return null;
  const hsv = rgbToHsv(rgb);
  return { h: hsv.h, s: hsv.s };
}
