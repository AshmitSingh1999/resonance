import type { SettingsValues } from '@resonance/shared';

/** Where settings lived before they were schema-driven. */
const LEGACY_PREFS_KEY = 'resonance.prefs';
const LEGACY_OFFSET_KEY = 'resonance.offsetMs';

/**
 * Old preference keys, mapped to their schema ids.
 *
 * Only the names changed; the values were already validated against the same
 * ranges, so the schema's own sanitise handles the rest.
 */
const RENAMED: Record<string, string> = {
  scheme: 'scheme',
  familyOverride: 'family',
  backdrop: 'backdrop',
  layout: 'layout',
  backdropEnabled: 'backdropEnabled',
  showMeters: 'showMeters',
  audioSource: 'audioSource',
};

/**
 * Carry settings forward from the pre-schema layout.
 *
 * Without this, everyone's configuration silently resets on upgrade — the lyric
 * offset especially, which is tuned by ear and annoying to find again. Returns
 * null when there is nothing to migrate.
 */
export function migrateLegacySettings(storage: Pick<Storage, 'getItem'>): SettingsValues | null {
  const values: SettingsValues = {};

  try {
    const raw = storage.getItem(LEGACY_PREFS_KEY);
    if (raw !== null) {
      const stored = JSON.parse(raw) as Record<string, unknown>;
      for (const [oldKey, id] of Object.entries(RENAMED)) {
        if (Object.hasOwn(stored, oldKey)) values[id] = stored[oldKey] as SettingsValues[string];
      }
    }
  } catch {
    // Corrupt legacy data is not worth failing over; defaults are fine.
  }

  // The offset was stored separately, as a bare number under its own key.
  const offset = Number(storage.getItem(LEGACY_OFFSET_KEY));
  if (Number.isFinite(offset) && storage.getItem(LEGACY_OFFSET_KEY) !== null) {
    values['offsetMs'] = offset;
  }

  return Object.keys(values).length === 0 ? null : values;
}
