/**
 * Every user-facing setting, declared as data.
 *
 * Settings used to be written three times: once as a control in the panel, once
 * as a field in a hand-written validator, and once as a key in a preferences
 * type. Declaring them once and deriving all three removes the opportunity for
 * those to disagree — which they did, when `backdrop` changed from a boolean to
 * an id and a stale stored value reached the shader as an unknown key.
 */

export type SettingGroup =
  | 'typography'
  | 'colour'
  | 'motion'
  | 'backdrop'
  | 'audio'
  | 'sync'
  | 'lyrics'
  | 'lights'
  | 'display';

/**
 * Where a setting is stored.
 *
 * `daemon` settings live in the daemon's config file rather than the browser,
 * because the bulb must keep working with no page open — and because its
 * credentials must never cross to the browser. Only persistence cares; the
 * renderer treats both alike.
 */
export type SettingOwner = 'browser' | 'daemon';

export type SettingValue = number | boolean | string | null;

interface Common {
  id: string;
  group: SettingGroup;
  label: string;
  /** One line shown under the control. */
  hint?: string;
  /** Hidden until the group's Advanced toggle is on. */
  advanced?: boolean;
  owner?: SettingOwner;
  /** Disabled with this reason shown, for controls whose feature is unfinished. */
  unavailable?: string;
}

export interface RangeSetting extends Common {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  /** Renders the current value, e.g. as a percentage or with units. */
  format?: (value: number) => string;
}

export interface ToggleSetting extends Common {
  kind: 'toggle';
  default: boolean;
}

export interface ChipsSetting extends Common {
  kind: 'chips';
  options: { value: string; label: string; hint?: string }[];
  /** `null` means "decide automatically", rendered as an `auto` chip. */
  default: string | null;
  nullable?: boolean;
}

export type Setting = RangeSetting | ToggleSetting | ChipsSetting;

export type SettingsValues = Record<string, SettingValue>;

const percent = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * The schema.
 *
 * Order within a group is the order shown, so related controls sit together.
 */
export const SETTINGS: Setting[] = [
  // --- typography --------------------------------------------------------
  {
    id: 'family',
    group: 'typography',
    label: 'Typeface family',
    hint: 'Auto follows lyric density and audio energy.',
    kind: 'chips',
    nullable: true,
    default: null,
    options: [
      { value: 'serene', label: 'serene' },
      { value: 'pulse', label: 'pulse' },
      { value: 'cascade', label: 'cascade' },
      { value: 'drift', label: 'drift' },
      { value: 'fracture', label: 'fracture' },
      { value: 'editorial', label: 'editorial' },
      { value: 'marquee', label: 'marquee' },
    ],
  },
  {
    id: 'layout',
    group: 'typography',
    label: 'Arrangement',
    kind: 'chips',
    default: 'centred',
    options: [
      { value: 'centred', label: 'centred', hint: 'active line centred' },
      { value: 'rail', label: 'rail', hint: 'artwork beside the words' },
      { value: 'band', label: 'band', hint: 'two lines low, karaoke style' },
    ],
  },

  // --- colour ------------------------------------------------------------
  {
    id: 'scheme',
    group: 'colour',
    label: 'Colour scheme',
    hint: 'Auto samples the album artwork.',
    kind: 'chips',
    nullable: true,
    default: null,
    options: [
      { value: 'artwork', label: 'artwork' },
      { value: 'midnight', label: 'midnight' },
      { value: 'paper', label: 'paper', hint: 'dark ink on a light ground' },
      { value: 'neon', label: 'neon' },
      { value: 'mono', label: 'mono' },
    ],
  },

  // --- backdrop ----------------------------------------------------------
  {
    id: 'backdropEnabled',
    group: 'backdrop',
    label: 'Animated backdrop',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'backdrop',
    group: 'backdrop',
    label: 'Field',
    hint: 'Auto follows the typeface family.',
    kind: 'chips',
    default: 'auto',
    options: [
      { value: 'auto', label: 'auto' },
      { value: 'waves', label: 'waves' },
      { value: 'rings', label: 'rings' },
      { value: 'streaks', label: 'streaks' },
      { value: 'flow', label: 'flow' },
      { value: 'scan', label: 'scan' },
      { value: 'none', label: 'none' },
    ],
  },

  // --- audio -------------------------------------------------------------
  {
    id: 'audioSource',
    group: 'audio',
    label: 'Audio source',
    hint: 'Native asks permission once; browser needs the picker every session.',
    kind: 'chips',
    default: 'native',
    options: [
      { value: 'native', label: 'native' },
      { value: 'browser', label: 'browser' },
      { value: 'off', label: 'off' },
    ],
  },
  {
    id: 'showMeters',
    group: 'audio',
    label: 'Show meters',
    kind: 'toggle',
    default: false,
  },

  // --- sync --------------------------------------------------------------
  {
    id: 'offsetMs',
    group: 'sync',
    label: 'Lyric offset',
    hint: 'Positive shows lyrics later. Bluetooth usually needs +150 to +300 ms.',
    kind: 'range',
    min: -2000,
    max: 2000,
    step: 50,
    default: 0,
    format: (value) => `${value > 0 ? '+' : ''}${value} ms`,
  },

  // --- lights ------------------------------------------------------------
  {
    id: 'lightEnabled',
    group: 'lights',
    owner: 'daemon',
    label: 'Sync the bulb',
    kind: 'toggle',
    default: false,
  },
  {
    id: 'lightMode',
    group: 'lights',
    owner: 'daemon',
    label: 'Colour source',
    kind: 'chips',
    default: 'palette',
    options: [
      { value: 'palette', label: 'palette', hint: 'hue from the album art' },
      { value: 'spectrum', label: 'spectrum', hint: 'hue follows the sound' },
    ],
  },
  {
    id: 'lightUpdateHz',
    group: 'lights',
    owner: 'daemon',
    label: 'Updates / sec',
    hint: 'Around 20 is this bulb’s practical ceiling; higher self-corrects.',
    kind: 'range',
    min: 1,
    max: 50,
    step: 1,
    default: 8,
    format: (value) => `${value}/s`,
  },
  {
    id: 'lightMaxBrightness',
    group: 'lights',
    owner: 'daemon',
    label: 'Brightness',
    kind: 'range',
    min: 0.05,
    max: 1,
    step: 0.05,
    default: 0.9,
    format: percent,
  },
];

/** Lookup by id. Built once; the schema is static. */
export const SETTING_BY_ID: ReadonlyMap<string, Setting> = new Map(
  SETTINGS.map((setting) => [setting.id, setting]),
);

export function settingsInGroup(group: SettingGroup): Setting[] {
  return SETTINGS.filter((setting) => setting.group === group);
}

/** Ids the daemon owns, so persistence can split the record cleanly. */
export function daemonSettingIds(): string[] {
  return SETTINGS.filter((setting) => setting.owner === 'daemon').map((s) => s.id);
}

export function defaultValues(): SettingsValues {
  const values: SettingsValues = {};
  for (const setting of SETTINGS) values[setting.id] = setting.default;
  return values;
}
