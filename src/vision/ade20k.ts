/**
 * The ADE20K-150 vocabulary (as predicted by SegFormer) and how it relates
 * to Mode's zone kinds: which classes support a zone (semantic agreement),
 * which zone a class becomes in the offline scene map, and a photo category
 * guessed from the class mix. Pure.
 */
import type { SpaceType, ZoneKind } from '../../shared/types';

/** Class names by id (from the model config's id2label). */
export const ADE20K_LABELS: readonly string[] = [
  'wall', 'building', 'sky', 'floor', 'tree', 'ceiling', 'road', 'bed', 'windowpane', 'grass',
  'cabinet', 'sidewalk', 'person', 'earth', 'door', 'table', 'mountain', 'plant', 'curtain', 'chair',
  'car', 'water', 'painting', 'sofa', 'shelf', 'house', 'sea', 'mirror', 'rug', 'field',
  'armchair', 'seat', 'fence', 'desk', 'rock', 'wardrobe', 'lamp', 'bathtub', 'railing', 'cushion',
  'base', 'box', 'column', 'signboard', 'chest of drawers', 'counter', 'sand', 'sink', 'skyscraper', 'fireplace',
  'refrigerator', 'grandstand', 'path', 'stairs', 'runway', 'case', 'pool table', 'pillow', 'screen door', 'stairway',
  'river', 'bridge', 'bookcase', 'blind', 'coffee table', 'toilet', 'flower', 'book', 'hill', 'bench',
  'countertop', 'stove', 'palm', 'kitchen island', 'computer', 'swivel chair', 'boat', 'bar', 'arcade machine', 'hovel',
  'bus', 'towel', 'light', 'truck', 'tower', 'chandelier', 'awning', 'streetlight', 'booth', 'television receiver',
  'airplane', 'dirt track', 'apparel', 'pole', 'land', 'bannister', 'escalator', 'ottoman', 'bottle', 'buffet',
  'poster', 'stage', 'van', 'ship', 'fountain', 'conveyer belt', 'canopy', 'washer', 'plaything', 'swimming pool',
  'stool', 'barrel', 'basket', 'waterfall', 'tent', 'bag', 'minibike', 'cradle', 'oven', 'ball',
  'food', 'step', 'tank', 'trade name', 'microwave', 'pot', 'animal', 'bicycle', 'lake', 'dishwasher',
  'screen', 'blanket', 'sculpture', 'hood', 'sconce', 'vase', 'traffic light', 'tray', 'ashcan', 'fan',
  'pier', 'crt screen', 'plate', 'monitor', 'bulletin board', 'shower', 'radiator', 'glass', 'clock', 'flag',
];

/** Class ids by name, for readable tables. */
export const ADE = Object.fromEntries(ADE20K_LABELS.map((name, i) => [name, i])) as Record<string, number>;

const ids = (...names: string[]): number[] =>
  names.map((n) => {
    const id = ADE[n];
    if (id === undefined) throw new Error(`Unknown ADE20K class "${n}"`);
    return id;
  });

const GROUND = ['road', 'sidewalk', 'path', 'earth', 'dirt track', 'floor', 'rock', 'sand', 'land'];
const BUILDING = ['wall', 'building', 'house', 'hovel', 'skyscraper', 'tower'];
const FURNITURE = ['sofa', 'chair', 'table', 'bed', 'armchair', 'desk', 'coffee table', 'ottoman', 'seat', 'swivel chair', 'stool', 'bench', 'pool table'];
const LIGHTS = ['lamp', 'light', 'chandelier', 'sconce'];

/**
 * Classes a correct mask of each zone kind mostly consists of. Used for the
 * semantic agreement check; kinds without an entry are not checked.
 * ADE20K has no roof, driveway, patio or mulch class — roofs mostly come out
 * as building/house, drives as road/sidewalk.
 */
export const ZONE_KIND_CLASSES: Partial<Record<ZoneKind, readonly number[]>> = {
  facade: ids(...BUILDING, 'windowpane', 'door', 'column', 'awning', 'railing'),
  roof: ids(...BUILDING, 'awning', 'canopy'),
  'front-door': ids('door', 'screen door'),
  'garage-door': ids('door', 'wall', 'building', 'house'),
  windows: ids('windowpane', 'blind', 'curtain'),
  trim: ids(...BUILDING, 'windowpane', 'door', 'column'),
  porch: ids(...BUILDING, 'floor', 'column', 'railing', 'stairs', 'stairway', 'step', 'bannister', 'awning', 'canopy', 'door', 'windowpane'),
  steps: ids('stairs', 'stairway', 'step', 'bannister', 'railing', 'floor', 'sidewalk', 'path'),
  columns: ids('column', 'building', 'house', 'wall'),
  walkway: ids(...GROUND),
  driveway: ids(...GROUND),
  sidewalk: ids('sidewalk', 'road', 'path', 'floor', 'earth'),
  street: ids('road', 'sidewalk', 'car', 'van', 'truck', 'bus'),
  lawn: ids('grass', 'field', 'earth', 'land', 'hill'),
  'planting-bed': ids('plant', 'flower', 'earth', 'grass', 'tree', 'rock', 'sand', 'pot', 'land', 'field'),
  'yard-border': ids('plant', 'flower', 'earth', 'grass', 'tree', 'rock', 'fence', 'field'),
  tree: ids('tree', 'palm', 'plant'),
  shrubs: ids('plant', 'tree', 'flower'),
  fence: ids('fence', 'railing', 'wall'),
  'retaining-wall': ids('wall', 'rock', 'building', 'fence'),
  patio: ids(...GROUND),
  deck: ids('floor', 'pier', 'railing', 'stairs', 'step', 'bridge'),
  pool: ids('swimming pool', 'water'),
  mailbox: ids('pole', 'signboard', 'box', 'base'),
  sky: ids('sky'),
  neighbor: ids(...BUILDING, 'tree', 'car', 'fence'),
  wall: ids('wall', 'painting', 'poster', 'mirror'),
  'accent-wall': ids('wall', 'painting', 'poster', 'mirror'),
  ceiling: ids('ceiling', 'chandelier', 'light', 'fan'),
  floor: ids('floor', 'rug'),
  window: ids('windowpane', 'curtain', 'blind'),
  door: ids('door', 'screen door'),
  cabinetry: ids('cabinet', 'wardrobe', 'chest of drawers', 'kitchen island', 'buffet', 'shelf', 'bookcase', 'counter', 'case'),
  countertop: ids('countertop', 'counter', 'kitchen island', 'sink'),
  backsplash: ids('wall', 'countertop', 'counter'),
  fireplace: ids('fireplace', 'wall'),
  stairs: ids('stairs', 'stairway', 'step', 'bannister', 'railing'),
  'built-ins': ids('shelf', 'bookcase', 'cabinet', 'wardrobe', 'case'),
  furniture: ids(...FURNITURE, 'cushion', 'pillow'),
  rug: ids('rug', 'floor'),
  'light-fixture': ids(...LIGHTS),
  decor: ids('painting', 'vase', 'pot', 'sculpture', 'cushion', 'pillow', 'mirror', 'clock', 'poster', 'plant', 'flower', 'basket'),
};

const classSetCache = new Map<ZoneKind, ReadonlySet<number>>();

/** The supporting classes of a zone kind as a set (empty = not checked). */
export function classesForZone(kind: ZoneKind): ReadonlySet<number> {
  let s = classSetCache.get(kind);
  if (!s) {
    s = new Set(ZONE_KIND_CLASSES[kind] ?? []);
    classSetCache.set(kind, s);
  }
  return s;
}

const EXTERIOR_MAP: Record<string, ZoneKind> = {
  wall: 'facade',
  building: 'facade',
  house: 'facade',
  hovel: 'facade',
  skyscraper: 'neighbor',
  tower: 'neighbor',
  sky: 'sky',
  tree: 'tree',
  palm: 'tree',
  grass: 'lawn',
  field: 'lawn',
  plant: 'planting-bed',
  flower: 'planting-bed',
  road: 'street',
  sidewalk: 'sidewalk',
  path: 'walkway',
  'dirt track': 'walkway',
  windowpane: 'windows',
  door: 'front-door',
  'screen door': 'front-door',
  fence: 'fence',
  railing: 'fence',
  stairs: 'steps',
  stairway: 'steps',
  step: 'steps',
  column: 'columns',
  'swimming pool': 'pool',
  floor: 'patio',
};

const INTERIOR_MAP: Record<string, ZoneKind> = {
  wall: 'wall',
  floor: 'floor',
  ceiling: 'ceiling',
  windowpane: 'window',
  curtain: 'window',
  blind: 'window',
  door: 'door',
  'screen door': 'door',
  cabinet: 'cabinetry',
  wardrobe: 'cabinetry',
  'chest of drawers': 'cabinetry',
  'kitchen island': 'cabinetry',
  buffet: 'cabinetry',
  countertop: 'countertop',
  counter: 'countertop',
  fireplace: 'fireplace',
  stairs: 'stairs',
  stairway: 'stairs',
  step: 'stairs',
  shelf: 'built-ins',
  bookcase: 'built-ins',
  rug: 'rug',
  ...Object.fromEntries(FURNITURE.map((n) => [n, 'furniture' as ZoneKind])),
  ...Object.fromEntries(LIGHTS.map((n) => [n, 'light-fixture' as ZoneKind])),
};

/**
 * The zone kind a semantic class becomes in the offline scene map (before
 * CLIPSeg refinements such as roof / driveway / patio / mulch beds). Null =
 * not mapped (people, cars, small objects…).
 */
export function zoneKindForClass(classId: number, interior: boolean): ZoneKind | null {
  const name = ADE20K_LABELS[classId];
  if (!name) return null;
  return (interior ? INTERIOR_MAP[name] : EXTERIOR_MAP[name]) ?? null;
}

/** Guesses what the photo shows from its class shares (index = class id, values 0..1). */
export function guessCategory(shares: ArrayLike<number>, interior: boolean): SpaceType {
  const s = (...names: string[]) => names.reduce((sum, n) => sum + (shares[ADE[n]] ?? 0), 0);
  if (interior) {
    const scores: [SpaceType, number][] = [
      ['kitchen', s('cabinet', 'countertop', 'counter', 'stove', 'refrigerator', 'kitchen island', 'dishwasher', 'oven', 'microwave', 'hood') * 3],
      ['bathroom', s('toilet', 'bathtub', 'shower', 'sink', 'towel') * 4 + (shares[ADE.mirror] ?? 0)],
      ['bedroom', s('bed', 'pillow', 'blanket', 'wardrobe') * 3],
      ['living-room', s('sofa', 'armchair', 'coffee table', 'fireplace', 'television receiver', 'cushion', 'ottoman') * 3],
      ['dining-room', s('table', 'chair', 'chandelier') * 2],
      ['office', s('desk', 'computer', 'monitor', 'swivel chair', 'bookcase') * 3],
      ['hallway', s('stairs', 'stairway', 'bannister', 'step') * 2],
    ];
    scores.sort((a, b) => b[1] - a[1]);
    return scores[0][1] >= 0.03 ? scores[0][0] : 'other-interior';
  }
  if (s('swimming pool') > 0.04) return 'pool-area';
  const building = s('building', 'house', 'wall', 'hovel');
  const yard = s('grass', 'field', 'plant', 'flower', 'earth', 'tree', 'palm');
  const drive = s('road');
  const paved = s('floor', 'path', 'sidewalk');
  if (drive > 0.3 && drive > yard && drive > building) return 'driveway';
  if (paved > 0.25 && paved > yard) return 'patio';
  if (building >= 0.2) return 'front-exterior';
  if (yard >= 0.25) return building > 0.05 ? 'front-yard' : 'garden';
  return 'other-exterior';
}
