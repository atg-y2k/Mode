/**
 * Procedural vector art specs for built-in placeable assets.
 * Rendered to SVG by src/assets/art (renderArt). Colors are '#rrggbb'.
 * `seed` makes organic shapes (foliage, petals) deterministic but varied.
 */

export const PLANT_FORMS = [
  'round-shrub',
  'upright-shrub',
  'spreading-shrub',
  'flowering-shrub',
  'conical-evergreen',
  'columnar',
  'deciduous-tree',
  'ornamental-tree',
  'weeping-tree',
  'palm',
  'ornamental-grass',
  'flowering-perennial',
  'groundcover',
  'succulent-rosette',
  'cactus',
  'fern',
  'vine-trellis',
  'hedge',
  'houseplant-broadleaf',
  'houseplant-upright',
  'houseplant-trailing',
  'potted-tree',
  'flower-bed',
] as const;
export type PlantForm = (typeof PLANT_FORMS)[number];

export interface PlantArt {
  kind: 'plant';
  form: PlantForm;
  /** Main foliage color. */
  foliage: string;
  /** Secondary foliage / highlight color. */
  foliage2?: string;
  /** Flower / berry color for flowering forms. */
  flower?: string;
  /** Trunk / stem color for trees. */
  trunk?: string;
  /** Pot color for potted forms (houseplants, potted-tree); omitted = in ground. */
  pot?: string;
  /** 0..1 foliage density (default 0.7). */
  density?: number;
  seed: number;
}

export const FIXTURE_FORMS = [
  'recessed',
  'pendant-dome',
  'pendant-globe',
  'pendant-cage',
  'chandelier',
  'sconce-up',
  'sconce-down',
  'wall-lantern',
  'flush-mount',
  'track',
  'floor-lamp',
  'table-lamp',
  'led-strip',
  'path-light',
  'bollard',
  'spotlight',
  'well-light',
  'string-lights',
  'post-lantern',
  'flood-light',
  'step-light',
  'ceiling-fan',
] as const;
export type FixtureForm = (typeof FIXTURE_FORMS)[number];

export interface FixtureArt {
  kind: 'fixture';
  form: FixtureForm;
  /** Metal finish color (black, brass, nickel, bronze…). */
  finish: string;
  /** Shade / glass color. */
  shade?: string;
}

export const DECOR_FORMS = [
  'planter-round',
  'planter-square',
  'planter-trough',
  'window-box',
  'bench',
  'outdoor-chair',
  'lounge-chair',
  'dining-set',
  'sofa',
  'armchair',
  'coffee-table',
  'rug',
  'fire-pit',
  'umbrella',
  'pergola',
  'boulder',
  'birdbath',
  'fountain',
  'raised-bed',
  'fence-panel',
  'arbor',
  'mailbox',
  'house-numbers',
  'shutters-pair',
  'awning',
  'trellis',
  'mirror',
  'wall-art',
] as const;
export type DecorForm = (typeof DECOR_FORMS)[number];

export interface DecorArt {
  kind: 'decor';
  form: DecorForm;
  color: string;
  color2?: string;
  seed?: number;
}

export type ArtSpec = PlantArt | FixtureArt | DecorArt;

/** Output of renderArt(). */
export interface ArtResult {
  /** Complete standalone SVG document string with explicit width/height/viewBox. */
  svg: string;
  width: number;
  height: number;
  /** 0..1 from the top: where the object's base / ground contact sits (usually ~0.97). */
  anchorY: number;
}
