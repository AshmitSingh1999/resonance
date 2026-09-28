import { describe, it, expect } from 'vitest';
import { migrateLegacySettings } from '../src/settingsMigration.js';
import { sanitiseSettings } from '@resonance/shared';

const storage = (entries: Record<string, string>) => ({
  getItem: (key: string) => entries[key] ?? null,
});

describe('migrateLegacySettings', () => {
  it('returns null when there is nothing to migrate', () => {
    expect(migrateLegacySettings(storage({}))).toBeNull();
  });

  it('carries the renamed preference across', () => {
    const migrated = migrateLegacySettings(storage({
      'resonance.prefs': JSON.stringify({ familyOverride: 'fracture', layout: 'band' }),
    }));
    expect(migrated).toMatchObject({ family: 'fracture', layout: 'band' });
  });

  it('carries the separately-stored lyric offset', () => {
    // Tuned by ear and irritating to find again, so losing it is the worst of
    // the possible regressions here.
    expect(migrateLegacySettings(storage({ 'resonance.offsetMs': '250' }))).toMatchObject({
      offsetMs: 250,
    });
  });

  it('carries a negative offset', () => {
    expect(migrateLegacySettings(storage({ 'resonance.offsetMs': '-150' }))).toMatchObject({
      offsetMs: -150,
    });
  });

  it('distinguishes a stored zero from an absent value', () => {
    expect(migrateLegacySettings(storage({ 'resonance.offsetMs': '0' }))).toMatchObject({
      offsetMs: 0,
    });
  });

  it('survives corrupt legacy data', () => {
    expect(migrateLegacySettings(storage({ 'resonance.prefs': '{not json' }))).toBeNull();
  });

  it('produces something the schema accepts', () => {
    const migrated = migrateLegacySettings(storage({
      'resonance.prefs': JSON.stringify({ scheme: 'paper', backdrop: 'scan', showMeters: true }),
      'resonance.offsetMs': '300',
    }))!;
    const sanitised = sanitiseSettings(migrated);
    expect(sanitised).toMatchObject({
      scheme: 'paper', backdrop: 'scan', showMeters: true, offsetMs: 300,
    });
  });

  it('drops legacy keys the schema no longer has', () => {
    const migrated = migrateLegacySettings(storage({
      'resonance.prefs': JSON.stringify({ layout: 'rail', retiredSetting: 'x' }),
    }))!;
    expect(migrated).not.toHaveProperty('retiredSetting');
  });
});
