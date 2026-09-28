interface Props {
  offsetMs: number;
  onNudge: (deltaMs: number) => void;
}

/**
 * Latency calibration.
 *
 * Audio reaches the ear later than the player reports its position, by an amount
 * that depends on the output device — Bluetooth headphones are far worse than
 * built-in speakers. There is no way to measure it from here, so the user tunes
 * it once by ear, and it is remembered.
 */
export function OffsetControl({ offsetMs, onNudge }: Props) {
  return (
    <div className="offset">
      <button type="button" onClick={() => onNudge(-50)} aria-label="Lyrics earlier by 50ms">
        −
      </button>
      <span className="offset__value">
        {offsetMs > 0 ? '+' : ''}
        {offsetMs} ms
      </span>
      <button type="button" onClick={() => onNudge(50)} aria-label="Lyrics later by 50ms">
        +
      </button>
      <span className="offset__hint">offset · ← →</span>
    </div>
  );
}
