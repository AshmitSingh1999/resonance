import type { Setting, SettingValue } from '@resonance/shared';
import { RangeControl } from './controls/RangeControl.js';
import { ToggleControl } from './controls/ToggleControl.js';
import { ChipsControl } from './controls/ChipsControl.js';

interface Props {
  setting: Setting;
  value: SettingValue;
  autoLabel?: string;
  onChange: (value: SettingValue) => void;
  onScrubChange?: (scrubbing: boolean) => void;
}

/**
 * Renders one setting from its declaration.
 *
 * The single place that knows how each `kind` looks, so adding a setting is a
 * schema entry rather than a new block of markup.
 */
export function SettingControl({ setting, value, autoLabel, onChange, onScrubChange }: Props) {
  const disabled = setting.unavailable !== undefined;

  const control =
    setting.kind === 'range' ? (
      <RangeControl
        setting={setting}
        value={typeof value === 'number' ? value : setting.default}
        disabled={disabled}
        onChange={onChange}
        onScrubChange={onScrubChange}
      />
    ) : setting.kind === 'toggle' ? (
      <ToggleControl
        setting={setting}
        value={typeof value === 'boolean' ? value : setting.default}
        disabled={disabled}
        onChange={onChange}
      />
    ) : (
      <ChipsControl
        setting={setting}
        value={typeof value === 'string' || value === null ? value : setting.default}
        disabled={disabled}
        autoLabel={autoLabel}
        onChange={onChange}
      />
    );

  if (!disabled) return control;
  // Shown but inert, with the reason: a control that silently does nothing is
  // worse than one that explains why it cannot yet.
  return (
    <div className="setting--unavailable">
      {control}
      <p className="setting__hint setting__hint--warn">{setting.unavailable}</p>
    </div>
  );
}
