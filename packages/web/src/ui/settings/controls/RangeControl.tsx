import type { RangeSetting } from '@resonance/shared';

interface Props {
  setting: RangeSetting;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Raised while the control is being dragged, for the live preview fade. */
  onScrubChange?: (scrubbing: boolean) => void;
}

export function RangeControl({ setting, value, disabled, onChange, onScrubChange }: Props) {
  return (
    <div className="setting setting--range">
      <div className="setting__head">
        <span className="setting__label">{setting.label}</span>
        <span className="setting__value">
          {setting.format ? setting.format(value) : String(value)}
        </span>
      </div>
      <input
        type="range"
        min={setting.min}
        max={setting.max}
        step={setting.step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        // Pointer events rather than a timer: the fade lifts exactly when the
        // drag ends, including when the pointer is released outside the panel.
        onPointerDown={() => onScrubChange?.(true)}
        onPointerUp={() => onScrubChange?.(false)}
        onPointerCancel={() => onScrubChange?.(false)}
        onBlur={() => onScrubChange?.(false)}
      />
      {setting.hint !== undefined && <p className="setting__hint">{setting.hint}</p>}
    </div>
  );
}
