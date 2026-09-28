import type { Palette, SchemeId } from '@resonance/shared';
import {
  ensureContrast,
  mix,
  relativeLuminance,
  toHex,
  type ExtractedPalette,
  type Rgb,
} from './palette.js';

export interface SchemeResult extends Palette {
  /** True when the scheme puts dark ink on a light ground. */
  light: boolean;
}

export interface SchemeDescriptor {
  id: SchemeId;
  label: string;
  /** One line for the settings panel. */
  note: string;
}

export const SCHEMES: SchemeDescriptor[] = [
  { id: 'artwork', label: 'artwork', note: 'sampled from the album cover' },
  { id: 'midnight', label: 'midnight', note: 'cool deep blue, artwork hue ignored' },
  { id: 'paper', label: 'paper', note: 'dark ink on a light ground' },
  { id: 'neon', label: 'neon', note: 'the cover’s colour, pushed hard' },
  { id: 'mono', label: 'mono', note: 'greyscale, shaded by the cover' },
];

/** Stands in when a track has no artwork to sample. */
const FALLBACK_ACCENT: Rgb = [232, 234, 240];
const FALLBACK_BG: Rgb = [8, 9, 12];

/**
 * Exaggerate a colour's colourfulness by pushing its channels away from their
 * midpoint. Cheap, and unlike an HSL round-trip it cannot shift the hue.
 */
function saturate(colour: Rgb, amount: number): Rgb {
  const mid = (Math.max(...colour) + Math.min(...colour)) / 2;
  return colour.map((c) => Math.max(0, Math.min(255, mid + (c - mid) * amount))) as Rgb;
}

function greyOf(value: number): Rgb {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  return [v, v, v];
}

/**
 * Apply a colour treatment to a track's artwork palette.
 *
 * Each scheme decides a ground and a candidate accent, then the shared
 * `ensureContrast` guarantees the result is readable — including for the light
 * scheme, since it already pushes toward white or black depending on which way
 * the ground sits. Legibility is never a per-scheme concern.
 */
export function applyScheme(scheme: SchemeId, artwork: ExtractedPalette | null): SchemeResult {
  const sourceAccent = artwork?.accentRgb ?? FALLBACK_ACCENT;
  const sourceBg = artwork?.backgroundRgb ?? FALLBACK_BG;
  // The dominant colour, not the darkened background: the latter is near-black
  // for every cover and so cannot tell two albums apart.
  const sourceDominant = artwork?.dominantRgb ?? FALLBACK_BG;

  let background: Rgb;
  let accent: Rgb;
  let light = false;

  switch (scheme) {
    case 'artwork':
      // Already contrast-checked by the extractor; returned verbatim so the
      // default look is exactly what the artwork produced.
      return {
        background: artwork?.background ?? toHex(FALLBACK_BG),
        dim: artwork?.dim ?? toHex(mix(FALLBACK_BG, FALLBACK_ACCENT, 0.42)),
        accent: artwork?.accent ?? toHex(FALLBACK_ACCENT),
        light: false,
      };

    case 'midnight':
      // A fixed cool ground: the point of this scheme is consistency across an
      // album's worth of differently-coloured covers.
      background = [10, 13, 24];
      accent = mix(sourceAccent, [186, 214, 255], 0.65);
      break;

    case 'paper':
      background = [244, 241, 234];
      // Start from the artwork's own darkest tone so the ink still belongs to
      // the record, then let the contrast pass take it the rest of the way.
      accent = mix(sourceDominant, [26, 24, 22], 0.6);
      light = true;
      break;

    case 'neon':
      // Near-black keeps the accent vivid: the darker the ground, the less the
      // contrast pass has to wash the colour out to make it readable.
      background = [4, 4, 7];
      accent = saturate(mix(sourceAccent, [255, 255, 255], 0.1), 3);
      break;

    case 'mono': {
      // Shaded by the cover's luminance so albums still differ, but never enough
      // to become a light scheme.
      const shade = relativeLuminance(...sourceDominant) * 26;
      background = greyOf(7 + shade);
      accent = greyOf(238);
      break;
    }
  }

  const readable = ensureContrast(accent, background);
  return {
    background: toHex(background),
    dim: toHex(mix(background, readable, 0.42)),
    accent: toHex(readable),
    light,
  };
}
