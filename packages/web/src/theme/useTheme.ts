import { useEffect, useRef, useState } from 'react';
import type { Lyrics, Theme, Track } from '@resonance/shared';
import { buildTheme, DEFAULT_PINS, type ThemePins } from './engine.js';
import { extractArtworkPalette } from './extractArtwork.js';
import type { ExtractedPalette } from './palette.js';

/**
 * Energy is quantised before it feeds the theme.
 *
 * Raw loudness moves constantly; rebuilding the theme on every change would swap
 * typeface and palette mid-verse. Bucketing means the look only revisits itself
 * when the track's character has genuinely shifted.
 */
const ENERGY_BUCKETS = 5;

export function useTheme(
  track: Track | null,
  lyrics: Lyrics | null,
  /** Running average of audio loudness, 0..1. */
  energy: number,
  pins: ThemePins = DEFAULT_PINS,
): Theme {
  const [palette, setPalette] = useState<ExtractedPalette | null>(null);
  const paletteForTrack = useRef<string | null>(null);

  // Artwork decoding is async, so it is keyed to the track it was started for —
  // a slow decode must not paint the previous song's colours over this one.
  useEffect(() => {
    const artwork = track?.artworkDataUrl ?? null;
    const trackId = track?.id ?? null;

    if (artwork === null) {
      paletteForTrack.current = trackId;
      setPalette(null);
      return;
    }

    let cancelled = false;
    void extractArtworkPalette(artwork).then((extracted) => {
      if (cancelled) return;
      paletteForTrack.current = trackId;
      setPalette(extracted);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.artworkDataUrl]);

  const bucket = Math.round(energy * ENERGY_BUCKETS) / ENERGY_BUCKETS;
  const [theme, setTheme] = useState<Theme>(() =>
    buildTheme({ lyrics: null, palette: null, energy: 0 }),
  );

  useEffect(() => {
    setTheme(buildTheme({ lyrics, palette, energy: bucket, pins }));
  }, [lyrics, palette, bucket, pins.scheme, pins.family, pins.backdrop, pins.layout]);

  return theme;
}
