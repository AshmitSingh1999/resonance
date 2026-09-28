/**
 * Deriving a readable colour scheme from album artwork.
 *
 * The artwork is the cheapest strong signal available: it already encodes how the
 * record wants to feel, and using it makes the screen look like it belongs to the
 * album. The constraint is that a palette taken from a picture must still be
 * legible as text, which the picture itself guarantees nothing about — so the
 * accent is adjusted until it meets a contrast floor.
 */

export type Rgb = [number, number, number];

export interface ExtractedPalette {
  background: string;
  dim: string;
  accent: string;
  backgroundRgb: Rgb;
  dimRgb: Rgb;
  accentRgb: Rgb;
  /**
   * The most populous colour of the artwork, before any darkening.
   *
   * Kept because `backgroundRgb` has already been crushed toward black and so
   * says almost nothing about how light or colourful the cover actually was —
   * which a scheme such as `mono` needs in order to tell two covers apart.
   */
  dominantRgb: Rgb;
}

/** Text needs to be comfortable at a glance across a room, not merely passable. */
export const MIN_CONTRAST = 7;

/** Used when artwork is absent or unusable. */
const NEUTRAL: Rgb = [232, 234, 240];
const NEUTRAL_BG: Rgb = [8, 9, 12];

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio, 1 to 21, independent of argument order. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(...a);
  const lb = relativeLuminance(...b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Colourfulness, 0 for grey. */
export function saturation([r, g, b]: Rgb): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

export function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

interface Cluster {
  colour: Rgb;
  count: number;
}

/**
 * Group pixels into colour clusters by population.
 *
 * Quantising to 4 bits per channel is enough to merge the near-identical shades
 * a photograph contains while keeping genuinely different colours apart, and it
 * is deterministic — unlike k-means with random seeding, which would give a
 * different palette each time the same track played.
 */
function clusterPixels(data: Uint8ClampedArray): Cluster[] {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();

  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha < 128) continue; // transparent pixels say nothing about the artwork

    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { r, g, b, count: 1 });
    else {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    }
  }

  return [...buckets.values()]
    .map(({ r, g, b, count }) => ({ colour: [r / count, g / count, b / count] as Rgb, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Force a colour to meet the contrast floor against the background.
 *
 * Pushes toward white or black — whichever direction the background is not — so
 * the accent keeps as much of its hue as legibility allows rather than being
 * discarded for a safe grey.
 */
/** Channels as they will actually be rendered, once written out as hex. */
function quantise(colour: Rgb): Rgb {
  return [Math.round(colour[0]), Math.round(colour[1]), Math.round(colour[2])];
}

export function ensureContrast(colour: Rgb, background: Rgb): Rgb {
  // Every check is made on quantised values. The ratio is only meaningful for
  // the colour that gets painted, and painting goes through an 8-bit hex triple
  // — guaranteeing the floor on unrounded floats let results land just under it.
  const ground = quantise(background);
  const start = quantise(colour);
  if (contrastRatio(start, ground) >= MIN_CONTRAST) return start;

  const target: Rgb = relativeLuminance(...ground) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  let low = 0;
  let high = 1;
  // Binary search the smallest shift that clears the floor, so hue is preserved
  // as far as possible.
  for (let i = 0; i < 14; i += 1) {
    const mid = (low + high) / 2;
    if (contrastRatio(quantise(mix(colour, target, mid)), ground) >= MIN_CONTRAST) high = mid;
    else low = mid;
  }

  let result = quantise(mix(colour, target, high));
  // The search works on a continuous amount; rounding can still land a hair
  // short, so step the last of the way rather than return something unreadable.
  for (let i = 0; i < 12 && contrastRatio(result, ground) < MIN_CONTRAST; i += 1) {
    result = quantise(mix(result, target, 0.08));
  }
  return result;
}

export function paletteFromPixels(data: Uint8ClampedArray): ExtractedPalette {
  const clusters = clusterPixels(data);

  if (clusters.length === 0) {
    const accent = NEUTRAL;
    const dim = mix(NEUTRAL_BG, accent, 0.35);
    return {
      backgroundRgb: NEUTRAL_BG,
      accentRgb: accent,
      dimRgb: dim,
      dominantRgb: NEUTRAL_BG,
      background: toHex(NEUTRAL_BG),
      accent: toHex(accent),
      dim: toHex(dim),
    };
  }

  // Background: the dominant colour, darkened hard. Keeping its hue ties the page
  // to the artwork; keeping it dark keeps the lyrics the brightest thing on screen.
  const dominant = clusters[0]!.colour;
  // Quantised up front: everything downstream reasons about the colour that will
  // actually be painted, not a float that rounds elsewhere.
  const background = quantise(mix(mix(dominant, [0, 0, 0], 0.86), NEUTRAL_BG, 0.35));

  // Accent: prefer a colourful cluster over the largest one, since the largest is
  // often a near-grey that would waste the artwork. Weight population by
  // saturation rather than taking the most saturated pixel, which may be noise.
  const totalPixels = clusters.reduce((sum, c) => sum + c.count, 0);
  let best = clusters[0]!;
  let bestScore = -1;
  for (const cluster of clusters) {
    const share = cluster.count / totalPixels;
    const score = (saturation(cluster.colour) / 255) * 0.75 + share * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = cluster;
    }
  }

  const accent = ensureContrast(best.colour, background);
  const dim = quantise(mix(background, accent, 0.42));

  return {
    backgroundRgb: background,
    accentRgb: accent,
    dimRgb: dim,
    dominantRgb: quantise(dominant),
    background: toHex(background),
    accent: toHex(accent),
    dim: toHex(dim),
  };
}
