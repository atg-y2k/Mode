/**
 * Mode — shared domain model.
 *
 * Everything the app persists (projects, spaces, photos, designs, asset list)
 * is described here. Pixel data (photos, masks, uploaded asset images) is NOT
 * stored inline: documents reference it by id and the bytes live in IndexedDB
 * (see src/state/persistence.ts).
 *
 * Coordinates are always in the photo's working-resolution pixel space
 * (Photo.width x Photo.height), origin top-left.
 * Real-world measurements are imperial (feet / inches / sq ft / gallons).
 */

import type { ArtSpec } from './art';

export type ID = string;

export interface Pt {
  x: number;
  y: number;
}

/** Four corners of a planar surface in the photo, clockwise from top-left. */
export type Quad = [Pt, Pt, Pt, Pt];

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export const INTERIOR_SPACE_TYPES = [
  'living-room',
  'bedroom',
  'kitchen',
  'bathroom',
  'dining-room',
  'office',
  'entryway',
  'hallway',
  'basement',
  'laundry',
  'nursery',
  'other-interior',
] as const;

export const EXTERIOR_SPACE_TYPES = [
  'front-exterior',
  'back-exterior',
  'side-exterior',
  'front-yard',
  'backyard',
  'side-yard',
  'patio',
  'deck',
  'pool-area',
  'garden',
  'driveway',
  'other-exterior',
] as const;

export const SPACE_TYPES = [...INTERIOR_SPACE_TYPES, ...EXTERIOR_SPACE_TYPES] as const;
export type InteriorSpaceType = (typeof INTERIOR_SPACE_TYPES)[number];
export type ExteriorSpaceType = (typeof EXTERIOR_SPACE_TYPES)[number];
export type SpaceType = (typeof SPACE_TYPES)[number];
export type SpaceKind = 'interior' | 'exterior';

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  'living-room': 'Living room',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  'dining-room': 'Dining room',
  office: 'Office',
  entryway: 'Entryway',
  hallway: 'Hallway',
  basement: 'Basement',
  laundry: 'Laundry',
  nursery: 'Nursery',
  'other-interior': 'Other interior',
  'front-exterior': 'Front of house',
  'back-exterior': 'Back of house',
  'side-exterior': 'Side of house',
  'front-yard': 'Front yard',
  backyard: 'Backyard',
  'side-yard': 'Side yard',
  patio: 'Patio',
  deck: 'Deck',
  'pool-area': 'Pool area',
  garden: 'Garden',
  driveway: 'Driveway',
  'other-exterior': 'Other exterior',
};

export function spaceKindOf(type: SpaceType): SpaceKind {
  return (INTERIOR_SPACE_TYPES as readonly string[]).includes(type) ? 'interior' : 'exterior';
}

// ---------------------------------------------------------------------------
// Surfaces & treatments
// ---------------------------------------------------------------------------

export const SURFACE_KINDS = [
  // interior
  'wall',
  'accent-wall',
  'ceiling',
  'trim',
  'door',
  'window-frame',
  'cabinet',
  'floor',
  'backsplash',
  'countertop',
  'stair',
  // exterior
  'siding',
  'roof',
  'shutters',
  'front-door',
  'garage-door',
  'fascia',
  'foundation',
  'fence',
  'deck',
  'patio',
  'path',
  'driveway',
  'lawn',
  'planting-bed',
  'retaining-wall',
  'other',
] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export const SURFACE_LABELS: Record<SurfaceKind, string> = {
  wall: 'Wall',
  'accent-wall': 'Accent wall',
  ceiling: 'Ceiling',
  trim: 'Trim / baseboard',
  door: 'Door',
  'window-frame': 'Window frame',
  cabinet: 'Cabinets',
  floor: 'Floor',
  backsplash: 'Backsplash',
  countertop: 'Countertop',
  stair: 'Stairs',
  siding: 'Siding',
  roof: 'Roof',
  shutters: 'Shutters',
  'front-door': 'Front door',
  'garage-door': 'Garage door',
  fascia: 'Fascia / soffit',
  foundation: 'Foundation',
  fence: 'Fence',
  deck: 'Deck',
  patio: 'Patio',
  path: 'Path / walkway',
  driveway: 'Driveway',
  lawn: 'Lawn',
  'planting-bed': 'Planting bed',
  'retaining-wall': 'Retaining wall',
  other: 'Other',
};

/** Surfaces that are normally horizontal (used for default texture mapping & quantity math). */
export const HORIZONTAL_SURFACES: readonly SurfaceKind[] = [
  'floor',
  'countertop',
  'deck',
  'patio',
  'path',
  'driveway',
  'lawn',
  'planting-bed',
  'ceiling',
];

export const PAINT_FINISHES = ['flat', 'matte', 'eggshell', 'satin', 'semi-gloss', 'gloss'] as const;
export type PaintFinish = (typeof PAINT_FINISHES)[number];

export interface PaintTreatment {
  type: 'paint';
  hex: string; // '#rrggbb'
  colorName?: string;
  /** Catalog id when picked from the built-in palette. */
  paintId?: string;
  /** Free text, e.g. "Benjamin Moore" — entered by the user or suggested by AI. */
  brand?: string;
  /** Manufacturer color code, e.g. "HC-154". */
  code?: string;
  finish: PaintFinish;
  coats: number; // default 2
  /** 0..1 blend strength of the effect (1 = full coverage). */
  strength: number;
}

export interface MaterialTreatment {
  type: 'material';
  materialId: string;
  /** Multiplier on the material's real tile size (1 = true size). */
  scale: number;
  /** Rotation of the pattern in degrees. */
  rotation: number;
  /** Optional color override multiplied into the texture. */
  tint?: string;
  strength: number; // 0..1
}

export type Treatment = PaintTreatment | MaterialTreatment;

/**
 * A selectable surface in a photo (e.g. "Back wall", "Front lawn").
 * Geometry (the mask) is shared by all designs of the photo; what is applied
 * to it lives in Design.treatments[region.id].
 */
export interface Region {
  id: ID;
  name: string;
  surface: SurfaceKind;
  /** Key of the mask bytes in persistence / runtime cache. Same pixel size as the photo. */
  maskId: ID;
  /** Overlay color used to highlight the region in the editor. */
  color: string;
  /** Optional perspective plane for realistic texture mapping. */
  plane?: {
    quad: Quad;
    /** Real-world size of the quad (enables true-to-scale textures and accurate area). */
    widthFt?: number;
    heightFt?: number;
  };
  /** Manual area override used for quantity math. */
  areaSqFtOverride?: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export const TIMES_OF_DAY = ['day', 'golden', 'dusk', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export interface LightingSettings {
  timeOfDay: TimeOfDay;
  /** Exposure in stops, -3..+3. */
  exposure: number;
  /** Target white balance of the ambient light in Kelvin (2000..9000). 5500 = neutral. */
  kelvin: number;
  /** 0..1 strength of the time-of-day effect (how dark "night" gets, etc.). */
  ambient: number;
  /** -1..1 */
  contrast: number;
  /** -1..1 */
  saturation: number;
}

export const DEFAULT_LIGHTING: LightingSettings = {
  timeOfDay: 'day',
  exposure: 0,
  kelvin: 5500,
  ambient: 0.75,
  contrast: 0,
  saturation: 0,
};

/**
 * How a light spreads:
 * omni — round glow; down — wash below the source (recessed, sconce, pendant);
 * up — uplight cone above (tree / wall uplights); spot — directional cone at `angle`;
 * strip — linear glow from (x,y) to (x2,y2) (under-cabinet, cove);
 * string — bulbs hanging along a catenary from (x,y) to (x2,y2).
 */
export const LIGHT_BEAMS = ['omni', 'down', 'up', 'spot', 'strip', 'string'] as const;
export type LightBeam = (typeof LIGHT_BEAMS)[number];

export interface PlacedLight {
  id: ID;
  /** Catalog / library asset id of the fixture (category 'lighting'), if any. */
  assetId?: ID;
  name: string;
  x: number;
  y: number;
  /** End point for strip / string beams. */
  x2?: number;
  y2?: number;
  beam: LightBeam;
  /** Reach of the light in photo pixels. */
  radius: number;
  /** 0..2 (1 = typical). */
  intensity: number;
  kelvin: number;
  /** Spot direction in degrees (0 = right, 90 = down). */
  angle?: number;
  /** Spot cone width in degrees. */
  spread?: number;
  on: boolean;
  /** Draw the fixture artwork at the light position. */
  showFixture: boolean;
  /** Fixture art height in photo pixels. */
  fixtureSize: number;
}

// ---------------------------------------------------------------------------
// Placed objects (plants, decor, fixtures art, custom uploads)
// ---------------------------------------------------------------------------

export interface PlacedObject {
  id: ID;
  assetId: ID;
  /** Position of the object's anchor (its base / ground contact point) in photo px. */
  x: number;
  y: number;
  /** Rendered height in photo px. Width follows the asset's aspect ratio. */
  height: number;
  rotation: number; // degrees
  flipX: boolean;
  opacity: number; // 0..1
  shadow: boolean;
  /** Stacking order; higher draws on top. Objects lower in the frame usually sit in front. */
  z: number;
  /** Optional color override applied to the art (where supported). */
  tint?: string;
  label?: string;
}

// ---------------------------------------------------------------------------
// Designs, photos, spaces, projects
// ---------------------------------------------------------------------------

export interface AIRender {
  id: ID;
  imageId: ID;
  prompt: string;
  provider: string;
  createdAt: number;
}

/** One redesign scheme of a photo ("Option A — warm modern"). */
export interface Design {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** regionId -> treatment. Regions without an entry are left as photographed. */
  treatments: Record<ID, Treatment>;
  /** Regions whose treatment is temporarily hidden in this design. */
  hiddenRegionIds: ID[];
  objects: PlacedObject[];
  lights: PlacedLight[];
  lighting: LightingSettings;
  aiRenders: AIRender[];
  notes?: string;
}

export interface Calibration {
  a: Pt;
  b: Pt;
  /** Real distance between a and b, in feet. */
  lengthFt: number;
}

export interface Photo {
  id: ID;
  name: string;
  /** Working-resolution JPEG/PNG in the blob store. */
  imageId: ID;
  /** Small preview in the blob store. */
  thumbId: ID;
  width: number;
  height: number;
  createdAt: number;
  regions: Region[];
  calibration?: Calibration;
  analysis?: SpaceAnalysis;
  designs: Design[];
  activeDesignId: ID;
}

export interface Space {
  id: ID;
  name: string;
  type: SpaceType;
  kind: SpaceKind;
  photos: Photo[];
  notes?: string;
  createdAt: number;
}

export interface ProjectLocation {
  zip?: string;
  /** USDA hardiness zone like "7a". */
  hardinessZone?: string;
  /** Free text: climate, HOA rules, sun orientation… */
  notes?: string;
}

export interface Project {
  id: ID;
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  location: ProjectLocation;
  /** Overall budget in USD (optional). */
  budget?: number;
  /** Overall style direction, e.g. "modern farmhouse", "drought-tolerant". */
  style?: string;
  spaces: Space[];
  assetList: AssetListItem[];
}

/** Lightweight listing record for the projects screen. */
export interface ProjectMeta {
  id: ID;
  name: string;
  updatedAt: number;
  createdAt: number;
  spaceCount: number;
  photoCount: number;
  /** Blob id of a thumbnail to show (first photo), if any. */
  coverThumbId?: ID;
}

// ---------------------------------------------------------------------------
// Assets (catalog + user/AI library)
// ---------------------------------------------------------------------------

export const COST_UNITS = ['each', 'gal', 'sqft', 'lnft', 'cuyd', 'ton', 'bag', 'flat', 'hour'] as const;
export type CostUnit = (typeof COST_UNITS)[number];

export interface CostEstimate {
  /** USD per unit, low and high typical retail. */
  low: number;
  high: number;
  unit: CostUnit;
}

export const COLOR_FAMILIES = [
  'white',
  'neutral',
  'gray',
  'black',
  'beige',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

export interface PaintColor {
  id: ID;
  name: string;
  hex: string;
  family: ColorFamily;
  /** Curated collection, e.g. "Warm whites", "Exterior classics". */
  collection: string;
  /** Suggested uses. */
  tags: string[];
}

export const TEXTURE_PATTERNS = [
  'wood-planks',
  'herringbone',
  'chevron',
  'tile-grid',
  'subway',
  'hex-tile',
  'brick',
  'stone-pavers',
  'flagstone',
  'cobblestone',
  'gravel',
  'mulch',
  'grass',
  'concrete',
  'stucco',
  'lap-siding',
  'board-batten',
  'shingle-siding',
  'roof-shingles',
  'standing-seam',
  'deck-boards',
  'carpet',
  'marble',
  'terrazzo',
  'stone-veneer',
  'shiplap',
] as const;
export type TexturePattern = (typeof TEXTURE_PATTERNS)[number];

/** Parameters for a procedural, seamlessly tiling texture. Dimensions in inches. */
export interface TextureSpec {
  pattern: TexturePattern;
  /** Base palette; generators pick per-element variation among these. */
  colors: string[];
  /** Size of one repeating element (plank, tile, brick, board) in inches. */
  unitWidthIn: number;
  unitHeightIn: number;
  /** Joint / grout / gap. */
  joint?: { color: string; widthIn: number };
  /** 0..1 amount of per-element color & grain variation. */
  variation: number;
  seed: number;
}

export const MATERIAL_CATEGORIES = [
  'flooring',
  'tile',
  'wall-finish',
  'siding',
  'roofing',
  'decking',
  'hardscape',
  'ground-cover',
  'countertop',
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export interface MaterialDef {
  id: ID;
  name: string;
  category: MaterialCategory;
  /** Surfaces this material is offered for. */
  surfaces: SurfaceKind[];
  texture: TextureSpec;
  /** Installed-material cost (not labor). Usually per sqft; mulch/gravel per cuyd or bag. */
  cost: CostEstimate;
  description: string;
  tags: string[];
}

export const ASSET_CATEGORIES = ['plant', 'lighting', 'decor', 'furniture', 'hardscape', 'other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const PLANT_TYPES = [
  'tree',
  'shrub',
  'perennial',
  'annual',
  'grass',
  'groundcover',
  'succulent',
  'vine',
  'fern',
  'houseplant',
  'hedge',
] as const;
export type PlantType = (typeof PLANT_TYPES)[number];
export type SunExposure = 'full-sun' | 'part-sun' | 'shade';
export type WaterNeed = 'low' | 'medium' | 'high';

export interface PlantInfo {
  botanical?: string;
  type: PlantType;
  sun: SunExposure[];
  water: WaterNeed;
  /** USDA zone range (numbers, e.g. 5..9). Undefined for houseplants. */
  zoneMin?: number;
  zoneMax?: number;
  matureHeightFt: number;
  matureWidthFt: number;
  evergreen: boolean;
  indoor: boolean;
  bloom?: string; // e.g. "Blue, early summer"
  /** Typical nursery size this cost refers to, e.g. "3 gal". */
  containerSize?: string;
  deerResistant?: boolean;
  native?: string; // e.g. "Eastern US"
}

export interface LightInfo {
  beam: LightBeam;
  kelvin: number;
  lumens: number;
  /** Typical reach of the light in feet (used to size the glow with calibration). */
  reachFt: number;
  /** Where the light emits from on the art, 0..1 from the top of the art. */
  emitterY: number;
  indoor: boolean;
  outdoor: boolean;
  /** Typical mounting height in feet (for default sizing). */
  mountHeightFt?: number;
}

/**
 * Something you can place on a photo: plants, fixtures, decor, furniture,
 * hardscape objects — built-in, uploaded by the user, or generated by AI.
 * Exactly one of `art`, `svg`, `imageId` provides the visual.
 */
export interface AssetDef {
  id: ID;
  name: string;
  category: AssetCategory;
  subcategory?: string;
  source: 'builtin' | 'user' | 'ai';
  /** Procedural vector art (built-ins). See src/assets/art/types.ts. */
  art?: ArtSpec;
  /** Raw SVG markup (AI-generated vector assets). */
  svg?: string;
  /** Raster image with transparency in the blob store (uploads, AI raster assets). */
  imageId?: ID;
  /** Width / height of the visual. */
  aspect: number;
  /** Typical real-world height in feet, used to size it when the photo is calibrated. */
  realHeightFt: number;
  tags: string[];
  description?: string;
  cost?: CostEstimate;
  vendorUrl?: string;
  plant?: PlantInfo;
  light?: LightInfo;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Asset list (shopping / materials list)
// ---------------------------------------------------------------------------

export const ASSET_LIST_CATEGORIES = [
  'paint',
  'lighting',
  'plants',
  'materials',
  'hardscape',
  'decor',
  'supplies',
  'labor',
  'other',
] as const;
export type AssetListCategory = (typeof ASSET_LIST_CATEGORIES)[number];

export const ASSET_LIST_STATUSES = ['idea', 'planned', 'ordered', 'purchased', 'installed'] as const;
export type AssetListStatus = (typeof ASSET_LIST_STATUSES)[number];

export interface AssetListItem {
  id: ID;
  name: string;
  category: AssetListCategory;
  quantity: number;
  /** "gal", "each", "sq ft", "cu yd", "bag", "lin ft", "flat"… */
  unit: string;
  /** Estimated USD per unit. */
  unitCost?: number;
  /** Spaces this item is for (Space ids). Empty = whole project. */
  spaceIds: ID[];
  /** How the row was created. Generated rows are replaced on regenerate unless `locked`. */
  source: 'manual' | 'generated' | 'ai';
  /** Stable key for generated rows so regenerate can update them in place. */
  generatorKey?: string;
  /** Catalog/library link (asset, material or paint id). */
  refId?: string;
  /** Color swatch for paint rows. */
  hex?: string;
  /** Short spec line, e.g. "Eggshell · 2 coats · ~640 sq ft". */
  specs?: string;
  vendor?: string;
  url?: string;
  notes?: string;
  status: AssetListStatus;
  /** User edited it; regenerate must not overwrite. */
  locked: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// AI analysis (stored on photos). Mirrors shared/api.ts SpaceAnalysisSchema.
// ---------------------------------------------------------------------------

export interface SpaceAnalysis {
  spaceType: SpaceType;
  summary: string;
  style: string;
  surfaces: { surface: SurfaceKind; description: string; currentColorHex: string | null; condition: string | null }[];
  lighting: { natural: string; artificial: string; issues: string[] };
  landscaping: { features: string[]; issues: string[] } | null;
  opportunities: string[];
  createdAt: number;
}
