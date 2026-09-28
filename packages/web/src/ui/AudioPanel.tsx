import type { TapState } from '../audio/tap.js';
import type { LiveAudio } from '../audio/tap.js';

interface Props {
  state: TapState;
  audio: LiveAudio;
  showMeters: boolean;
  /** Native capture needs no user gesture, so it offers no enable control. */
  native: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter">
      <span className="meter__label">{label}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ transform: `scaleX(${value})` }} />
      </span>
    </div>
  );
}

/**
 * The audio-reactivity control, and the meters used to judge whether the
 * features are actually tracking the music.
 *
 * The prompt is explicit rather than firing Chrome's picker unannounced: the
 * picker asks to share a *screen*, which is alarming if you did not ask for it,
 * and it is easy to complete without ticking the audio box.
 */
export function AudioPanel({ state, audio, showMeters, native, onEnable, onDisable }: Props) {
  if (state.status === 'listening') {
    return (
      <div className="audio audio--live">
        {showMeters && (
          <div className="meters">
            <Meter label="bass" value={audio.bass} />
            <Meter label="mid" value={audio.mid} />
            <Meter label="treble" value={audio.treble} />
            <Meter label="rms" value={audio.rms} />
            <Meter label="bright" value={audio.centroid} />
            <span className={`beat ${audio.onset ? 'beat--hit' : ''}`} aria-hidden />
          </div>
        )}
        {native ? (
          <span className="audio__toggle audio__toggle--static">reactive · system audio</span>
        ) : (
          <button type="button" className="audio__toggle" onClick={onDisable}>
            reactive · on
          </button>
        )}
      </div>
    );
  }

  if (native) {
    // Nothing for the listener to do: the daemon owns this, and its state is
    // reported rather than actioned.
    return (
      <div className="audio">
        <span className="audio__reason">
          {state.status === 'unavailable' ? state.reason : 'waiting for system audio…'}
        </span>
      </div>
    );
  }

  return (
    <div className="audio">
      {state.status === 'unavailable' && <span className="audio__reason">{state.reason}</span>}
      <button
        type="button"
        className="audio__toggle"
        onClick={onEnable}
        disabled={state.status === 'starting'}
      >
        {state.status === 'starting' ? 'waiting…' : 'enable audio reactivity'}
      </button>
    </div>
  );
}
