import type { LayoutId } from '@resonance/shared';

/**
 * How the lyric stack is arranged.
 *
 * A layout is a descriptor, not a variant of the component. `LyricStage` keeps
 * one DOM structure and one measured-centring path; only the line counts and a
 * class name change. That matters because the centring measures the active
 * line's real offset — the thing that makes wrapped lines sit correctly — and
 * forking it per layout would reintroduce bugs that measurement exists to fix.
 */
export interface LayoutDescriptor {
  id: LayoutId;
  label: string;
  note: string;
  /** Context lines kept above the active line. */
  contextBefore: number;
  /** Context lines kept below the active line. */
  contextAfter: number;
  className: string;
}

export const LAYOUTS: LayoutDescriptor[] = [
  {
    id: 'centred',
    label: 'centred',
    note: 'active line centred, context fading away',
    contextBefore: 2,
    contextAfter: 3,
    className: 'layout-centred',
  },
  {
    id: 'rail',
    label: 'rail',
    note: 'large artwork beside the words',
    contextBefore: 2,
    contextAfter: 4,
    className: 'layout-rail',
  },
  {
    id: 'band',
    label: 'band',
    note: 'two lines low, karaoke style',
    contextBefore: 0,
    contextAfter: 1,
    className: 'layout-band',
  },
];

export function layoutById(id: LayoutId): LayoutDescriptor {
  return LAYOUTS.find((layout) => layout.id === id) ?? LAYOUTS[0]!;
}
