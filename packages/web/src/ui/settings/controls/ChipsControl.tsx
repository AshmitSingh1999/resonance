import type { ChipsSetting } from '@resonance/shared';

interface Props {
  setting: ChipsSetting;
  value: string | null;
  disabled?: boolean;
  /** What the engine chose, shown against the `auto` chip. */
  autoLabel?: string;
  onChange: (value: string | null) => void;
}

export function ChipsControl({ setting, value, disabled, autoLabel, onChange }: Props) {
  return (
    <div className="setting setting--chips">
      <div className="setting__head">
        <span className="setting__label">{setting.label}</span>
      </div>
      <div className="setting__chips">
        {setting.nullable === true && (
          <button
            type="button"
            className={value === null ? 'chip chip--on' : 'chip'}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            auto{autoLabel !== undefined && <span className="chip__note"> {autoLabel}</span>}
          </button>
        )}
        {setting.options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            className={value === option.value ? 'chip chip--on' : 'chip'}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {setting.hint !== undefined && <p className="setting__hint">{setting.hint}</p>}
    </div>
  );
}
