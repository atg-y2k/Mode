/**
 * Display metadata for scene zones and paths (labels, sun, grouping) and the
 * mapping from a zone kind to the Fine-tune surface kind used when a zone's
 * outline is refined with the hand tools. Pure.
 */
import {
  CONTEXT_ZONE_KINDS,
  type SceneMap,
  type ScenePath,
  type SceneZone,
  type SurfaceKind,
  type ZoneKind,
} from '../../../../shared/types';

export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  facade: 'Facade',
  roof: 'Roof',
  'front-door': 'Front door',
  'garage-door': 'Garage door',
  windows: 'Windows',
  trim: 'Trim',
  porch: 'Porch',
  steps: 'Steps',
  columns: 'Columns',
  walkway: 'Walkway',
  driveway: 'Driveway',
  sidewalk: 'Sidewalk',
  lawn: 'Lawn',
  'planting-bed': 'Planting bed',
  'yard-border': 'Yard border',
  tree: 'Tree',
  shrubs: 'Shrubs',
  fence: 'Fence',
  'retaining-wall': 'Retaining wall',
  patio: 'Patio',
  deck: 'Deck',
  pool: 'Pool',
  mailbox: 'Mailbox',
  sky: 'Sky',
  street: 'Street',
  neighbor: 'Neighbor',
  wall: 'Wall',
  'accent-wall': 'Accent wall',
  ceiling: 'Ceiling',
  floor: 'Floor',
  window: 'Window',
  door: 'Door',
  cabinetry: 'Cabinetry',
  countertop: 'Countertop',
  backsplash: 'Backsplash',
  fireplace: 'Fireplace',
  stairs: 'Stairs',
  'built-ins': 'Built-ins',
  furniture: 'Furniture',
  rug: 'Rug',
  'light-fixture': 'Light fixture',
  decor: 'Decor',
  other: 'Other',
};

/** Fine-tune surface for a zone kind ("Refine outline" creates a Surface region of this kind). */
const ZONE_SURFACE: Record<ZoneKind, SurfaceKind> = {
  facade: 'siding',
  roof: 'roof',
  'front-door': 'front-door',
  'garage-door': 'garage-door',
  windows: 'window-frame',
  trim: 'trim',
  porch: 'deck',
  steps: 'stair',
  columns: 'trim',
  walkway: 'path',
  driveway: 'driveway',
  sidewalk: 'path',
  lawn: 'lawn',
  'planting-bed': 'planting-bed',
  'yard-border': 'planting-bed',
  tree: 'other',
  shrubs: 'planting-bed',
  fence: 'fence',
  'retaining-wall': 'retaining-wall',
  patio: 'patio',
  deck: 'deck',
  pool: 'other',
  mailbox: 'other',
  sky: 'other',
  street: 'other',
  neighbor: 'other',
  wall: 'wall',
  'accent-wall': 'accent-wall',
  ceiling: 'ceiling',
  floor: 'floor',
  window: 'window-frame',
  door: 'door',
  cabinetry: 'cabinet',
  countertop: 'countertop',
  backsplash: 'backsplash',
  fireplace: 'other',
  stairs: 'stair',
  'built-ins': 'cabinet',
  furniture: 'other',
  rug: 'floor',
  'light-fixture': 'other',
  decor: 'other',
  other: 'other',
};

export function zoneSurface(kind: ZoneKind): SurfaceKind {
  return ZONE_SURFACE[kind] ?? 'other';
}

export function zoneKindLabel(kind: ZoneKind): string {
  return ZONE_KIND_LABELS[kind] ?? 'Area';
}

export type Sun = NonNullable<SceneZone['sun']>;

export const SUN_OPTIONS: { value: Sun; label: string; short: string }[] = [
  { value: 'full-sun', label: 'Full sun', short: 'Sun' },
  { value: 'part-sun', label: 'Part sun', short: 'Part sun' },
  { value: 'shade', label: 'Shade', short: 'Shade' },
];

export function sunLabel(sun: SceneZone['sun']): string | null {
  return SUN_OPTIONS.find((o) => o.value === sun)?.label ?? null;
}

export const PATH_KIND_LABELS: Record<ScenePath['kind'], string> = {
  existing: 'Existing',
  suggested: 'Suggested',
  sketch: 'Sketched',
};

/** True for zones the Studio can change (not sky / street / neighbors, not marked context by the AI). */
export function isDesignZone(z: Pick<SceneZone, 'kind' | 'editable'>): boolean {
  return z.editable && !CONTEXT_ZONE_KINDS.includes(z.kind);
}

/**
 * Zones to offer as "where" targets for an element: relevant kinds first (in
 * scene order), then the other editable zones. Context zones are excluded.
 */
export function zonesForElement(scene: SceneMap | undefined, relevantKinds: readonly ZoneKind[]): { relevant: SceneZone[]; other: SceneZone[] } {
  const zones = (scene?.zones ?? []).filter(isDesignZone);
  return {
    relevant: zones.filter((z) => relevantKinds.includes(z.kind)),
    other: zones.filter((z) => !relevantKinds.includes(z.kind)),
  };
}

/** Zones split into design targets and context (shown dimmed, never changed). */
export function splitZones(zones: readonly SceneZone[]): { design: SceneZone[]; context: SceneZone[] } {
  return { design: zones.filter(isDesignZone), context: zones.filter((z) => !isDesignZone(z)) };
}

/** Zones whose sun exposure matters for planting (they get a sun control in the Scene panel). */
export const GROUND_ZONE_KINDS: readonly ZoneKind[] = [
  'lawn',
  'planting-bed',
  'yard-border',
  'shrubs',
  'tree',
  'walkway',
  'sidewalk',
  'driveway',
  'patio',
  'deck',
  'porch',
  'steps',
  'retaining-wall',
  'fence',
  'pool',
];
