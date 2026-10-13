/**
 * Which surfaces to offer first for a space, sensible paint defaults per
 * surface and small naming helpers. Pure (no React, no catalog) so it is
 * unit-tested directly.
 */
import {
  HORIZONTAL_SURFACES,
  SURFACE_KINDS,
  SURFACE_LABELS,
  type PaintFinish,
  type SpaceType,
  type SurfaceKind,
  spaceKindOf,
} from '../../../../shared/types';

/** Surfaces you find inside a house, in a natural "what would I change first" order. */
export const INTERIOR_SURFACES: readonly SurfaceKind[] = [
  'wall',
  'accent-wall',
  'ceiling',
  'trim',
  'floor',
  'door',
  'window-frame',
  'cabinet',
  'backsplash',
  'countertop',
  'stair',
];

/** Surfaces of the house exterior and the yard. */
export const EXTERIOR_SURFACES: readonly SurfaceKind[] = [
  'siding',
  'trim',
  'front-door',
  'shutters',
  'roof',
  'garage-door',
  'fascia',
  'foundation',
  'lawn',
  'planting-bed',
  'path',
  'patio',
  'deck',
  'driveway',
  'fence',
  'retaining-wall',
];

const INTERIOR_DEFAULT: SurfaceKind[] = ['wall', 'accent-wall', 'ceiling', 'trim', 'floor', 'door', 'window-frame', 'cabinet'];
const FACADE: SurfaceKind[] = ['siding', 'trim', 'front-door', 'shutters', 'roof', 'garage-door', 'fascia', 'foundation'];
const YARD: SurfaceKind[] = ['lawn', 'planting-bed', 'path', 'patio', 'fence', 'retaining-wall', 'driveway', 'deck'];

/** The 8 most relevant surfaces per space type. */
const PRIMARY_BY_SPACE: Record<SpaceType, SurfaceKind[]> = {
  'living-room': INTERIOR_DEFAULT,
  bedroom: INTERIOR_DEFAULT,
  'dining-room': INTERIOR_DEFAULT,
  office: INTERIOR_DEFAULT,
  nursery: INTERIOR_DEFAULT,
  'other-interior': INTERIOR_DEFAULT,
  kitchen: ['wall', 'cabinet', 'backsplash', 'countertop', 'floor', 'ceiling', 'trim', 'accent-wall'],
  bathroom: ['wall', 'floor', 'backsplash', 'cabinet', 'countertop', 'ceiling', 'trim', 'door'],
  laundry: ['wall', 'cabinet', 'floor', 'backsplash', 'countertop', 'ceiling', 'trim', 'door'],
  entryway: ['wall', 'floor', 'door', 'trim', 'stair', 'ceiling', 'accent-wall', 'window-frame'],
  hallway: ['wall', 'floor', 'trim', 'door', 'stair', 'ceiling', 'accent-wall', 'window-frame'],
  basement: ['wall', 'floor', 'ceiling', 'stair', 'trim', 'door', 'accent-wall', 'cabinet'],
  'front-exterior': FACADE,
  'back-exterior': ['siding', 'trim', 'deck', 'patio', 'roof', 'door', 'shutters', 'foundation'],
  'side-exterior': ['siding', 'trim', 'fence', 'roof', 'foundation', 'path', 'planting-bed', 'shutters'],
  'front-yard': ['lawn', 'planting-bed', 'path', 'driveway', 'fence', 'retaining-wall', 'siding', 'front-door'],
  backyard: YARD,
  'side-yard': ['path', 'planting-bed', 'lawn', 'fence', 'retaining-wall', 'patio', 'siding', 'deck'],
  garden: ['planting-bed', 'lawn', 'path', 'patio', 'fence', 'retaining-wall', 'deck', 'siding'],
  patio: ['patio', 'deck', 'path', 'lawn', 'planting-bed', 'fence', 'siding', 'retaining-wall'],
  deck: ['deck', 'siding', 'fence', 'patio', 'lawn', 'planting-bed', 'trim', 'path'],
  'pool-area': ['patio', 'deck', 'fence', 'lawn', 'planting-bed', 'path', 'retaining-wall', 'siding'],
  driveway: ['driveway', 'path', 'lawn', 'planting-bed', 'garage-door', 'siding', 'retaining-wall', 'fence'],
  'other-exterior': ['siding', 'trim', 'lawn', 'planting-bed', 'path', 'patio', 'fence', 'roof'],
};

/**
 * Surfaces to offer for a space: the most relevant ones first (`primary`), then
 * every other kind (`more`) — same-setting kinds before the other setting's,
 * "Other" last. Every SurfaceKind appears exactly once across both lists.
 */
export function surfaceKindsFor(spaceType: SpaceType | undefined, kind?: 'interior' | 'exterior'): {
  primary: SurfaceKind[];
  more: SurfaceKind[];
} {
  const setting = kind ?? (spaceType ? spaceKindOf(spaceType) : 'interior');
  const primary = spaceType ? [...PRIMARY_BY_SPACE[spaceType]] : setting === 'interior' ? [...INTERIOR_DEFAULT] : [...FACADE];
  const seen = new Set<SurfaceKind>(primary);
  const ordered = setting === 'interior' ? [...INTERIOR_SURFACES, ...EXTERIOR_SURFACES] : [...EXTERIOR_SURFACES, ...INTERIOR_SURFACES];
  const more: SurfaceKind[] = [];
  for (const k of ordered) {
    if (!seen.has(k)) {
      seen.add(k);
      more.push(k);
    }
  }
  // Anything the two lists above missed (e.g. 'other' or future kinds), "Other" last.
  for (const k of SURFACE_KINDS) if (!seen.has(k) && k !== 'other') more.push(k);
  if (!primary.includes('other')) more.push('other');
  return { primary, more };
}

/** One-line description shown as a tooltip on "Add surface" tiles. */
export const SURFACE_HINTS: Record<SurfaceKind, string> = {
  wall: 'Painted walls of the room',
  'accent-wall': 'One wall in a bolder color or finish',
  ceiling: 'The ceiling plane',
  trim: 'Baseboards, casings and crown molding',
  door: 'Interior doors',
  'window-frame': 'Window frames and sashes',
  cabinet: 'Kitchen, bath or built-in cabinet fronts',
  floor: 'Wood, tile, stone or carpet floors',
  backsplash: 'Tile behind the counter or vanity',
  countertop: 'Kitchen and bath counters',
  stair: 'Treads, risers and stringers',
  siding: 'The main wall cladding of the house',
  roof: 'Shingles, metal or tile roofing',
  shutters: 'Window shutters',
  'front-door': 'The front door — a great place for color',
  'garage-door': 'Garage doors',
  fascia: 'Fascia boards, soffits and eaves',
  foundation: 'Exposed foundation or skirting',
  fence: 'Fences and gates',
  deck: 'Deck boards',
  patio: 'Patio paving',
  path: 'Walkways and garden paths',
  driveway: 'The driveway surface',
  lawn: 'Grass areas',
  'planting-bed': 'Beds with mulch, gravel or ground cover',
  'retaining-wall': 'Retaining and garden walls',
  other: 'Anything else you want to change',
};

/** Typical paint sheen for a surface (what a painter would recommend). */
export function defaultFinishFor(surface: SurfaceKind): PaintFinish {
  switch (surface) {
    case 'ceiling':
    case 'lawn':
    case 'planting-bed':
      return 'flat';
    case 'wall':
    case 'accent-wall':
    case 'other':
      return 'eggshell';
    case 'trim':
    case 'door':
    case 'window-frame':
    case 'cabinet':
    case 'shutters':
    case 'front-door':
    case 'stair':
    case 'backsplash':
    case 'countertop':
      return 'semi-gloss';
    default:
      return 'satin';
  }
}

/** Surfaces that are normally covered with a material rather than paint. */
const MATERIAL_FIRST: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
  'lawn',
  'planting-bed',
  'path',
  'driveway',
  'patio',
  'countertop',
  'backsplash',
  'roof',
  'floor',
]);

/** True when paint is an unusual choice for the surface (a material usually looks more real). */
export function prefersMaterial(surface: SurfaceKind): boolean {
  return MATERIAL_FIRST.has(surface);
}

export function isHorizontalSurface(surface: SurfaceKind): boolean {
  return HORIZONTAL_SURFACES.includes(surface);
}

/** Lower-case surface noun for sentences ("Paint the trim / baseboard"). */
export function surfaceNoun(surface: SurfaceKind): string {
  return SURFACE_LABELS[surface].toLowerCase();
}

/**
 * When a region's surface type changes, rename it too if it still carries an
 * auto-generated name of the old type ("Wall", "Wall 2" → "Siding", "Siding 2").
 * Custom names are kept. `taken` are the other regions' names in the photo.
 */
export function renameForSurfaceChange(name: string, from: SurfaceKind, to: SurfaceKind, taken: readonly string[]): string {
  if (from === to) return name;
  const oldLabel = SURFACE_LABELS[from];
  const trimmed = name.trim();
  const auto = trimmed === oldLabel || new RegExp(`^${escapeRegExp(oldLabel)} \\d+$`).test(trimmed);
  if (!auto) return name;
  const base = SURFACE_LABELS[to];
  const used = new Set(taken.map((t) => t.trim()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return base;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
