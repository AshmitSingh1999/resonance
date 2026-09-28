import { useState } from 'react';
import type { SettingGroup, SettingsValues, SettingValue } from '@resonance/shared';
import { settingsInGroup } from '@resonance/shared';
import { SettingControl } from './SettingControl.js';

/** Tab order. Groups with no settings yet are skipped automatically. */
const GROUPS: { id: SettingGroup; label: string }[] = [
  { id: 'typography', label: 'Typography' },
  { id: 'colour', label: 'Colour' },
  { id: 'motion', label: 'Motion' },
  { id: 'backdrop', label: 'Backdrop' },
  { id: 'audio', label: 'Audio' },
  { id: 'sync', label: 'Sync' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'lights', label: 'Lights' },
  { id: 'display', label: 'Display' },
];

interface Props {
  open: boolean;
  values: SettingsValues;
  /** What the engine chose, per setting id, shown against `auto` chips. */
  autoLabels?: Record<string, string>;
  /** Shown at the top of the Lights tab. */
  lightsStatus?: string;
  onChange: (id: string, value: SettingValue) => void;
  onClose: () => void;
}

/**
 * The settings panel.
 *
 * Holds no knowledge of any individual setting: it renders whatever the schema
 * declares, which is what keeps it from growing a block of markup per control
 * the way its predecessor did.
 */
export function SettingsPanel({
  open,
  values,
  autoLabels,
  lightsStatus,
  onChange,
  onClose,
}: Props) {
  const [active, setActive] = useState<SettingGroup>('typography');
  const [advanced, setAdvanced] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  if (!open) return null;

  const populated = GROUPS.filter((group) => settingsInGroup(group.id).length > 0);
  const inGroup = settingsInGroup(active);
  const visible = advanced ? inGroup : inGroup.filter((setting) => setting.advanced !== true);
  const hiddenCount = inGroup.length - visible.length;

  return (
    <aside
      // Faded while a slider is dragged so the change is visible on the lyrics
      // behind the panel.
      className={`panel ${scrubbing ? 'panel--previewing' : ''}`}
      role="dialog"
      aria-label="Settings"
    >
      <header className="panel__head">
        <h2>Settings</h2>
        <button type="button" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </header>

      <div className="panel__body">
        <nav className="panel__tabs" aria-label="Settings sections">
          {populated.map((group) => (
            <button
              key={group.id}
              type="button"
              className={group.id === active ? 'panel__tab panel__tab--on' : 'panel__tab'}
              onClick={() => setActive(group.id)}
            >
              {group.label}
            </button>
          ))}
        </nav>

        <div className="panel__content">
          {active === 'lights' && lightsStatus !== undefined && (
            <p className="setting__hint">{lightsStatus}</p>
          )}

          {visible.map((setting) => (
            <SettingControl
              key={setting.id}
              setting={setting}
              value={values[setting.id] ?? setting.default}
              autoLabel={autoLabels?.[setting.id]}
              onChange={(value) => onChange(setting.id, value)}
              onScrubChange={setScrubbing}
            />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              className="panel__advanced"
              onClick={() => setAdvanced(true)}
            >
              Show {hiddenCount} advanced setting{hiddenCount === 1 ? '' : 's'}
            </button>
          )}
          {advanced && hiddenCount === 0 && inGroup.some((s) => s.advanced) && (
            <button type="button" className="panel__advanced" onClick={() => setAdvanced(false)}>
              Hide advanced settings
            </button>
          )}
        </div>
      </div>

      <footer className="panel__foot">
        <kbd>←</kbd> <kbd>→</kbd> offset · <kbd>m</kbd> meters · <kbd>s</kbd> settings ·
        <kbd>f</kbd> fullscreen
      </footer>
    </aside>
  );
}
