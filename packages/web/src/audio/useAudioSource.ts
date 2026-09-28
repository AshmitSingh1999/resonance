import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioFrame, NativeAudioState } from '@resonance/shared';
import { AudioTap, type LiveAudio, type TapState } from './tap.js';
import { NativeAudioSource, SilentAudioSource } from './source.js';
import { SILENCE } from './features.js';

export type AudioSourceChoice = 'native' | 'browser' | 'off';

export interface AudioSourceHandle {
  choice: AudioSourceChoice;
  state: TapState;
  /** Called every frame by the renderer, so it must stay cheap. */
  read: () => LiveAudio;
  /** Only meaningful for the browser source; native needs no user gesture. */
  enable: () => Promise<void>;
  disable: () => void;
  acceptFrame: (frame: AudioFrame) => void;
  acceptState: (state: NativeAudioState, detail?: string) => void;
}

/**
 * Selects where audio features come from.
 *
 * Native is preferred and needs no interaction: the daemon's helper holds a
 * macOS permission that was granted once. The browser tap remains as a fallback
 * for machines where the helper cannot run, at the cost of a screen-share picker
 * every session — which is the friction this whole path exists to remove.
 */
export function useAudioSource(choice: AudioSourceChoice): AudioSourceHandle {
  const nativeRef = useRef<NativeAudioSource | null>(null);
  if (nativeRef.current === null) nativeRef.current = new NativeAudioSource();

  const tapRef = useRef<AudioTap | null>(null);
  if (tapRef.current === null) tapRef.current = new AudioTap();

  const silent = useMemo(() => new SilentAudioSource(), []);
  const [, forceRender] = useState(0);

  // The native source mutates outside React, so its state changes need nudging
  // into a render; polling is simpler here than threading events through.
  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (choice !== 'browser') tapRef.current?.stop();
  }, [choice]);

  const enable = useCallback(async () => {
    if (choice !== 'browser') return;
    await tapRef.current!.start();
    forceRender((n) => n + 1);
  }, [choice]);

  const disable = useCallback(() => {
    tapRef.current!.stop();
    forceRender((n) => n + 1);
  }, []);

  const read = useCallback(() => {
    if (choice === 'off') return silent.read();
    if (choice === 'native') return nativeRef.current!.read();
    return tapRef.current!.read();
  }, [choice, silent]);

  const state =
    choice === 'off'
      ? silent.state
      : choice === 'native'
        ? nativeRef.current.state
        : tapRef.current.state;

  return {
    choice,
    state,
    read,
    enable,
    disable,
    acceptFrame: useCallback((frame) => nativeRef.current!.acceptFrame(frame), []),
    acceptState: useCallback(
      (nativeState, detail) => nativeRef.current!.acceptState(nativeState, detail),
      [],
    ),
  };
}

export { SILENCE };
