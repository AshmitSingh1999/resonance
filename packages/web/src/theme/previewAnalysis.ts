/**
 * Characterising a track from its 30-second preview.
 *
 * This exists because with no live audio the theme engine has no energy signal at
 * all and falls back to lyric density, which makes almost everything read as a
 * quiet track. A 30-second excerpt cannot drive reactivity — it is the wrong part
 * of the song and only a fragment of it — but it is a fair sample of a track's
 * character, which is all the theme needs.
 */

export interface PreviewProfile {
  /** Loudness, 0..1. */
  energy: number;
  /** Perceptual brightness, 0..1. */
  brightness: number;
}

export const SILENT_PROFILE: PreviewProfile = { energy: 0, brightness: 0 };

/**
 * Reduce raw PCM to the two numbers the theme engine consumes.
 *
 * Deliberately no FFT. Energy is RMS, and brightness is the zero-crossing rate —
 * a long-established cheap proxy for spectral centroid. Since nothing downstream
 * reads a spectrum, computing one would be code with no consumer.
 */
export function analysePcm(samples: Float32Array): PreviewProfile {
  if (samples.length === 0) return SILENT_PROFILE;

  let sumSquares = 0;
  let crossings = 0;
  let previous = samples[0]!;

  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]!;
    sumSquares += value * value;
    // Counted on a sign change, ignoring exact zeros so digital silence does not
    // register as maximally bright.
    if ((value > 0 && previous < 0) || (value < 0 && previous > 0)) crossings += 1;
    previous = value;
  }

  const rms = Math.sqrt(sumSquares / samples.length);

  // Music rarely exceeds ~0.3 RMS, so scale to put ordinary tracks across a
  // usable range rather than bunched at the bottom.
  const energy = Math.min(1, rms * 3.2);

  // A crossing rate of ~0.25 per sample is already very bright content; above
  // that is noise rather than anything musical.
  const brightness = Math.min(1, crossings / samples.length / 0.25);

  return { energy, brightness };
}

/**
 * Fetch and analyse a preview.
 *
 * Returns null rather than throwing: a preview is an enhancement, and every
 * failure path here — offline, a 404, an undecodable body — must leave the theme
 * working exactly as it did before.
 */
export async function profilePreview(url: string): Promise<PreviewProfile | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      return analysePcm(decoded.getChannelData(0));
    } finally {
      // Decoding is one-shot; holding the context open would waste an audio unit.
      void context.close();
    }
  } catch {
    return null;
  }
}
