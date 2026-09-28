import { useEffect, useRef } from 'react';
import { Backdrop as Renderer, parseColour } from '../gl/backdrop.js';
import type { Theme } from '@resonance/shared';
import type { LiveAudio } from '../audio/tap.js';

interface Props {
  theme: Theme;
  /** Reads the newest audio frame. Called per frame, so it must stay cheap. */
  readAudio: () => LiveAudio;
  enabled: boolean;
}

/**
 * The animated field behind the lyrics.
 *
 * Holds its own animation loop and reads audio through a callback rather than
 * taking it as a prop, so 60fps of audio never becomes 60 React renders. If
 * WebGL is unavailable the canvas is simply left out and the page looks like the
 * plain themed background.
 */
export function Backdrop({ theme, readAudio, enabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !enabled) return;

    const renderer = new Renderer();
    if (!renderer.init(canvas)) return;

    let frame = 0;
    const loop = () => {
      const current = themeRef.current;
      const audio = readAudio();
      renderer.resize(canvas);
      renderer.render({
        bass: audio.bass,
        mid: audio.mid,
        treble: audio.treble,
        onset: audio.onset,
        intensity: current.intensity,
        backdrop: current.backdrop,
        light: current.light,
        background: parseColour(current.palette.background, [8, 9, 12]),
        accent: parseColour(current.palette.accent, [245, 246, 248]),
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
    };
  }, [enabled, readAudio]);

  if (!enabled) return null;
  return <canvas className="backdrop" ref={canvasRef} aria-hidden />;
}
