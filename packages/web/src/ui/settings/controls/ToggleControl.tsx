import type { ToggleSetting } from '@resonance/shared';

interface Props {
  setting: ToggleSetting;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleControl({ setting, value, disabled, onChange }: Props) {
  return (
    <div className="setting setting--toggle">
      <label className="setting__head">
        <span className="setting__label">{setting.label}</span>
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
      {setting.hint !== undefined && <p className="setting__hint">{setting.hint}</p>}
    </div>
  );
}
