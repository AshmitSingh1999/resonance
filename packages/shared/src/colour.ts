/**
 * Colour conversions shared by the display and the light bridge.
 *
 * The bulb speaks HSV with hue in degrees, while the theme carries hex strings
 * derived from album artwork — so getting a hue out of the palette needs this on
 * the daemon side, not just in the page.
 */

export type Rgb = [number, number, number];

export interface Hsv {
  /** 0..360, never exactly 360. */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    // Normalise into [0, 360) — a negative result is ordinary for reds leaning
    // toward magenta, and 360 itself is out of range for the device.
    if (h < 0) h += 360;
    if (h >= 360) h -= 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const chroma = v * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = v - chroma;

  let rgb: [number, number, number];
  if (sector < 1) rgb = [chroma, second, 0];
  else if (sector < 2) rgb = [second, chroma, 0];
  else if (sector < 3) rgb = [0, chroma, second];
  else if (sector < 4) rgb = [0, second, chroma];
  else if (sector < 5) rgb = [second, 0, chroma];
  else rgb = [chroma, 0, second];

  return rgb.map((channel) => Math.round((channel + match) * 255)) as Rgb;
}

/**
 * Parse `#rrggbb`. Returns null for anything else.
 *
 * Deliberately strict: the theme's palette can hold `rgb()` or `color-mix()`
 * values, and scraping digits out of those produced a plausible-looking but
 * entirely wrong colour once already.
 */
export function hexToRgb(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) return null;
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
