import { paletteFromPixels, type ExtractedPalette } from './palette.js';

/**
 * Artwork is downscaled before sampling.
 *
 * A cover is often 600px square or larger; sampling every pixel would mean a
 * third of a million reads for a result that a small thumbnail gives identically,
 * since the browser's own downscale already averages neighbouring pixels.
 */
const SAMPLE_SIZE = 56;

/**
 * Read a colour palette out of album artwork.
 *
 * Returns null rather than throwing when the image cannot be decoded — artwork is
 * an enhancement, and a track with a corrupt cover should still get a theme.
 */
export async function extractArtworkPalette(dataUrl: string): Promise<ExtractedPalette | null> {
  try {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;

    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return paletteFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('artwork failed to decode'));
    image.src = src;
  });
}
