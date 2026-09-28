import {
  analyseSpectrum,
  smooth,
  OnsetDetector,
  SILENCE,
  type AudioFeatures,
  type SpectrumContext,
} from './features.js';

export type TapState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'listening' }
  /** Running without audio: the visuals fall back to metadata-driven motion. */
  | { status: 'unavailable'; reason: string };

/** Live features plus the beat flag, which is per-frame rather than smoothed. */
export interface LiveAudio extends AudioFeatures {
  onset: boolean;
}

/**
 * How quickly each feature follows the signal.
 *
 * Bass drives scale, so it is smoothed hardest — untreated it jitters and the
 * type appears to vibrate. Treble drives fine detail and can afford to be quick.
 */
const SMOOTHING = { bass: 0.18, mid: 0.22, treble: 0.3, rms: 0.15, centroid: 0.08 } as const;

/**
 * Captures the Mac's audio output and turns it into per-frame features.
 *
 * Apple opened system-audio capture to third-party apps in macOS 14.2 and Chrome
 * exposes it through `getDisplayMedia`, so the page can listen to whatever is
 * playing without any native helper. The catch is that the user must tick
 * "Share system audio" in Chrome's picker; a stream can arrive with video and no
 * audio track at all, which is reported rather than left as silence.
 */
export class AudioTap {
  #context: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #stream: MediaStream | null = null;
  #spectrum: Uint8Array = new Uint8Array(0);
  #onsets = new OnsetDetector();
  #features: AudioFeatures = { ...SILENCE };

  state: TapState = { status: 'idle' };

  get spectrumContext(): SpectrumContext | null {
    return this.#context === null || this.#analyser === null
      ? null
      : { sampleRate: this.#context.sampleRate, fftSize: this.#analyser.fftSize };
  }

  /** Must be called from a user gesture; browsers refuse capture otherwise. */
  async start(): Promise<TapState> {
    this.state = { status: 'starting' };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          // Processing meant for speech would fight the music.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      const name = (error as Error).name;
      this.state = {
        status: 'unavailable',
        reason: name === 'NotAllowedError' ? 'permission declined' : (error as Error).message,
      };
      return this.state;
    }

    const [audioTrack] = stream.getAudioTracks();
    if (audioTrack === undefined) {
      // The picker was completed without sharing audio, which is easy to do.
      stream.getTracks().forEach((track) => track.stop());
      this.state = {
        status: 'unavailable',
        reason: 'no audio track — “Share system audio” was not enabled',
      };
      return this.state;
    }

    // Only the audio is wanted; holding the video track would keep the screen
    // capture indicator lit and waste a frame pipeline.
    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    // The analyser has its own smoothing; keep it light and smooth per feature
    // instead, so each can follow at a rate suited to what it drives.
    analyser.smoothingTimeConstant = 0.5;
    context.createMediaStreamSource(stream).connect(analyser);

    this.#context = context;
    this.#analyser = analyser;
    this.#stream = stream;
    this.#spectrum = new Uint8Array(analyser.frequencyBinCount);
    this.#onsets = new OnsetDetector();

    // The user can end sharing from Chrome's own bar, which must not look like
    // a crash.
    audioTrack.addEventListener('ended', () => {
      this.state = { status: 'unavailable', reason: 'sharing stopped' };
    });

    this.state = { status: 'listening' };
    return this.state;
  }

  /** Read one frame. Returns silence when not listening. */
  read(): LiveAudio {
    const analyser = this.#analyser;
    const ctx = this.spectrumContext;
    if (analyser === null || ctx === null || this.state.status !== 'listening') {
      return { ...SILENCE, onset: false };
    }

    analyser.getByteFrequencyData(this.#spectrum);
    const target = analyseSpectrum(this.#spectrum, ctx);
    const current = this.#features;

    this.#features = {
      bass: smooth(current.bass, target.bass, SMOOTHING.bass),
      mid: smooth(current.mid, target.mid, SMOOTHING.mid),
      treble: smooth(current.treble, target.treble, SMOOTHING.treble),
      rms: smooth(current.rms, target.rms, SMOOTHING.rms),
      centroid: smooth(current.centroid, target.centroid, SMOOTHING.centroid),
    };

    // Onsets run on the raw spectrum: smoothing would blunt the transient that
    // defines a beat.
    return { ...this.#features, onset: this.#onsets.push(this.#spectrum) };
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    void this.#context?.close();
    this.#context = null;
    this.#analyser = null;
    this.#stream = null;
    this.state = { status: 'idle' };
  }
}
