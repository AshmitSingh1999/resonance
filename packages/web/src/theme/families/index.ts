import type { AnimationFamily as FamilyId, BackdropId } from '@resonance/shared';

/**
 * A kinetic typography family.
 *
 * Each family is a plain descriptor plus a CSS class. The motion itself lives in
 * stylesheet rules keyed on that class, reading the same audio custom properties
 * every family gets — so a family is added by writing a descriptor and a block of
 * CSS, touching no existing code, and the animation stays on the compositor
 * rather than running through JavaScript every frame.
 */
export interface FamilyDescriptor {
  id: FamilyId;
  /** Where this family sits in trait space, 0..1 on each axis. */
  affinity: { energy: number; density: number };
  typeface: string;
  /** Variable-font weight axis the renderer animates between. */
  weightRange: [number, number];
  case: 'none' | 'upper';
  /** Baseline line-height; the engine adjusts it for lyric density. */
  leading: number;
  /** Baseline motion amplitude before audio energy modulates it. */
  intensity: number;
  /**
   * The backdrop this family reads best against.
   *
   * Only a default: the backdrop is a separate dimension the listener can pin,
   * so a family no longer dictates the field behind it.
   */
  defaultBackdrop: BackdropId;
}

const SERENE: FamilyDescriptor = {
  id: 'serene',
  defaultBackdrop: 'waves',
  affinity: { energy: 0.15, density: 0.2 },
  typeface: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  weightRange: [300, 500],
  case: 'none',
  leading: 1.5,
  intensity: 0.25,
};

const PULSE: FamilyDescriptor = {
  id: 'pulse',
  defaultBackdrop: 'rings',
  affinity: { energy: 0.85, density: 0.7 },
  typeface: '"Helvetica Neue", Inter, "SF Pro Display", system-ui, sans-serif',
  weightRange: [600, 900],
  case: 'upper',
  leading: 1.05,
  intensity: 0.85,
};

/** Dense delivery: many words in little time, so they arrive in sequence. */
const CASCADE: FamilyDescriptor = {
  id: 'cascade',
  defaultBackdrop: 'streaks',
  affinity: { energy: 0.6, density: 0.95 },
  typeface: '"SF Compact Display", "Helvetica Neue", Inter, system-ui, sans-serif',
  weightRange: [500, 800],
  case: 'none',
  leading: 1.0,
  intensity: 0.7,
};

/** Ambient and electronic: slow travel, few words, room to breathe. */
const DRIFT: FamilyDescriptor = {
  id: 'drift',
  defaultBackdrop: 'flow',
  affinity: { energy: 0.4, density: 0.05 },
  typeface: '"Avenir Next", Futura, "Century Gothic", system-ui, sans-serif',
  weightRange: [200, 400],
  case: 'none',
  leading: 1.7,
  intensity: 0.45,
};

/** Aggressive material: hard transients, high contrast, deliberate instability. */
const FRACTURE: FamilyDescriptor = {
  id: 'fracture',
  defaultBackdrop: 'scan',
  affinity: { energy: 1, density: 0.45 },
  typeface: '"SF Mono", "JetBrains Mono", Menlo, ui-monospace, monospace',
  weightRange: [600, 900],
  case: 'upper',
  leading: 1.15,
  intensity: 1,
};

/**
 * The implemented families.
 *
 * Selection works over whatever is in this list, so a new family is added by
 * writing a descriptor and a block of CSS — no selection logic changes.
 */
/** Editorial: magazine stillness — large serif, generous measure, little motion. */
const EDITORIAL: FamilyDescriptor = {
  id: 'editorial',
  defaultBackdrop: 'waves',
  affinity: { energy: 0.3, density: 0.5 },
  typeface: '"New York", "Iowan Old Style", Charter, Georgia, serif',
  weightRange: [400, 700],
  case: 'none',
  leading: 1.35,
  intensity: 0.35,
};

/** Marquee: wide condensed caps with a lateral drift, like a hoarding. */
const MARQUEE: FamilyDescriptor = {
  id: 'marquee',
  defaultBackdrop: 'streaks',
  affinity: { energy: 0.75, density: 0.3 },
  typeface: '"SF Compact Display", "Haettenschweiler", "Arial Narrow", Impact, sans-serif',
  weightRange: [700, 900],
  case: 'upper',
  leading: 1.1,
  intensity: 0.75,
};

export const FAMILIES: FamilyDescriptor[] = [
  SERENE, PULSE, CASCADE, DRIFT, FRACTURE, EDITORIAL, MARQUEE,
];

export function familyById(id: FamilyId): FamilyDescriptor {
  return FAMILIES.find((family) => family.id === id) ?? FAMILIES[0]!;
}

export interface FamilyTraits {
  energy: number;
  density: number;
}

/** The family whose affinity sits closest to the track's traits. */
export function chooseFamily(traits: FamilyTraits): FamilyDescriptor {
  let best = FAMILIES[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const family of FAMILIES) {
    // Energy is weighted above density: how a track feels is driven more by its
    // force than by how many words it fits in.
    const de = (family.affinity.energy - traits.energy) * 1.4;
    const dd = family.affinity.density - traits.density;
    const distance = de * de + dd * dd;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = family;
    }
  }
  return best;
}
