import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientMsg, SettingsValues, SettingValue } from '@resonance/shared';
import { coerceSetting, sanitiseSettings, splitByOwner } from '@resonance/shared';
import { migrateLegacySettings } from './settingsMigration.js';

const STORAGE_KEY = 'resonance.settings';

/**
 * All settings, from both sides.
 *
 * Browser-owned values persist to `localStorage`; daemon-owned ones are pushed
 * over the socket and stored by the daemon, so the bulb keeps its behaviour with
 * no page open. Callers read one flat record and do not need to know which is
 * which.
 */
export function useSettings(
  send: (message: ClientMsg) => void,
  /** Daemon-owned values as last reported, so the daemon remains the authority. */
  daemonValues: SettingsValues | null,
): [SettingsValues, (id: string, value: SettingValue) => void] {
  const [local, setLocal] = useState<SettingsValues>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return sanitiseSettings(JSON.parse(stored));
      // First run after the schema landed: carry the old layout forward rather
      // than silently resetting a configuration the listener tuned by ear.
      return sanitiseSettings(migrateLegacySettings(localStorage));
    } catch {
      return sanitiseSettings(null);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(splitByOwner(local).browser));
    } catch {
      // Private browsing can refuse writes; the session still works without.
    }
  }, [local]);

  // The daemon's copy wins for what it owns: it keeps running when no page is
  // open, so its state is the truth rather than whatever this tab last saw.
  const values = useMemo(
    () => (daemonValues === null ? local : { ...local, ...daemonValues }),
    [local, daemonValues],
  );

  const update = useCallback(
    (id: string, value: SettingValue) => {
      const coerced = coerceSetting(id, value);
      if (coerced === undefined) return; // not a setting we know
      setLocal((current) => ({ ...current, [id]: coerced }));

      const { daemon } = splitByOwner({ [id]: coerced });
      if (Object.hasOwn(daemon, id)) send({ t: 'settings', values: daemon });
    },
    [send],
  );

  return [values, update];
}
