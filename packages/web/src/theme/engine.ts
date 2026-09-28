import type {
  AnimationFamily,
  BackdropId,
  LayoutId,
  Lyrics,
  SchemeId,
  Theme,
} from '@resonance/shared';
import { lyricDensity, lyricValence } from './traits.js';
import { chooseFamily, familyById } from './families/index.js';
import { applyScheme } from './schemes.js';
import { layoutById } from './layouts.js';
import type { ExtractedPalette } from './palette.js';

/**
 * Pinned dimensions.
 *
 * Each is independently `null`/`'auto'` for "let the engine decide", so a
 * disagreeable automatic choice can be corrected one dimension at a time rather
 * than by overriding the whole look.
 */
export interface ThemePins {
  scheme: SchemeId | null;
  family: AnimationFamily | null;
  backdrop: BackdropId | 'auto';
  layout: LayoutId;
}

export const DEFAULT_PINS: ThemePins = {
  scheme: null,
  family: null,
  backdrop: 'auto',
  layout: 'centred',
};

export interface ThemeInputs {
  lyrics: Lyrics | null;
  /** Extracted from album artwork, when there is any. */
  palette: ExtractedPalette | null;
  /** Averaged audio loudness, 0..1. Zero when reactivity is off. */
  energy: number;
  pins?: ThemePins;
}

/** Words per second at which lyrics count as maximally dense. */
const DENSE_WPS = 4;

/**
 * Chooses how a track should look.
 *
 * Runs once per track, and again if audio reactivity is switched on mid-song. It
 * is deliberately separate from the per-frame motion: this picks the typeface,
 * palette and family, while the live audio only modulates within what is chosen
 * here. Recomputing the whole look every frame would make the screen restless.
 */
export function buildTheme({ lyrics, palette, energy, pins = DEFAULT_PINS }: ThemeInputs): Theme {
  const wordsPerSecond = lyricDensity(lyrics);
  const density = Math.min(1, wordsPerSecond / DENSE_WPS);

  const text = lyrics === null ? '' : lyrics.lines.map((line) => line.text).join(' ');
  const valence = lyricValence(text);

  // Without audio, density stands in for energy: rapid delivery is usually an
  // energetic track, so the family choice stays reasonable with reactivity off.
  const effectiveEnergy = energy > 0 ? energy * 0.7 + density * 0.3 : density;

  const chosen = chooseFamily({ energy: effectiveEnergy, density });
  const family = pins.family === null ? chosen : familyById(pins.family);

  const scheme = pins.scheme ?? 'artwork';
  const colours = applyScheme(scheme, palette);
  const layout = layoutById(pins.layout);

  return {
    family: family.id,
    scheme,
    backdrop: pins.backdrop === 'auto' ? family.defaultBackdrop : pins.backdrop,
    layout: layout.id,
    light: colours.light,
    typeface: family.typeface,
    weightRange: family.weightRange,
    case: family.case,
    palette: { background: colours.background, dim: colours.dim, accent: colours.accent },
    // Bleak lyrics sit slightly calmer than the family's baseline, warm ones
    // slightly livelier — a nudge, not a second opinion.
    intensity: Math.max(
      0,
      Math.min(1, family.intensity * (0.75 + energy * 0.25) + valence * 0.08),
    ),
    // Dense lyrics need tighter leading or successive lines cannot be read in
    // the time available.
    leading: family.leading - density * 0.3,
  };
}
