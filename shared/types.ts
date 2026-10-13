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
// Studio: scene understanding, idea board, prompt-driven variations
// ---------------------------------------------------------------------------

/** What a zone of a photo is. The AI picks the closest kind; `label` carries the specifics. */
export const ZONE_KINDS = [
  // exterior — architecture
  'facade',
  'roof',
  'front-door',
  'garage-door',
  'windows',
  'trim',
  'porch',
  'steps',
  'columns',
  // exterior — site
  'walkway',
  'driveway',
  'sidewalk',
  'lawn',
  'planting-bed',
  'yard-border',
  'tree',
  'shrubs',
  'fence',
  'retaining-wall',
  'patio',
  'deck',
  'pool',
  'mailbox',
  'sky',
  'street',
  'neighbor',
  // interior
  'wall',
  'accent-wall',
  'ceiling',
  'floor',
  'window',
  'door',
  'cabinetry',
  'countertop',
  'backsplash',
  'fireplace',
  'stairs',
  'built-ins',
  'furniture',
  'rug',
  'light-fixture',
  'decor',
  'other',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Zones that are context, not design targets (never edited unless explicitly asked). */
export const CONTEXT_ZONE_KINDS: readonly ZoneKind[] = ['sky', 'street', 'neighbor'];

/** A labeled area of the photo found by AI scene analysis (and adjustable by the user). */
export interface SceneZone {
  id: ID;
  kind: ZoneKind;
  /** Specific name, e.g. "Front lawn (left of walk)", "Concrete walkway to front door". */
  label: string;
  /** Materials, colors, condition, size — what is there now. */
  description: string;
  /** Outline in photo px (AI-estimated, approximate). Closed polygon, ≥ 3 points. */
  polygon: Pt[];
  /** When the user refined the outline with the mask tools: runtime/persisted mask id. Takes precedence over `polygon`. */
  maskId?: ID;
  /** False for context zones (sky, street, neighbors). */
  editable: boolean;
  /** Estimated sun exposure for ground / planting zones (from orientation & shadows). */
  sun?: 'full-sun' | 'part-sun' | 'shade';
}

/** A route through the scene, e.g. "Driveway → front door". */
export interface ScenePath {
  id: ID;
  label: string;
  /** Where it starts / ends, in words ("driveway apron", "front door"). */
  from: string;
  to: string;
  /** Current surface, width, condition, or for suggested paths the proposed design. */
  description: string;
  /** Centerline in photo px. */
  points: Pt[];
  /** Approximate width in photo px at the near end (for drawing / masks). */
  widthPx: number;
  kind: 'existing' | 'suggested' | 'sketch';
}

/** Architectural reading of the photo — what the design must respect. */
export interface ArchitectureAnalysis {
  /** e.g. "Center-hall Colonial Revival", "1950s ranch", "Craftsman bungalow", "Mid-century modern living room". */
  style: string;
  /** Matching id from the design-knowledge styles, when one fits. */
  styleId?: string;
  era?: string;
  /** Defining features: roofline, symmetry, porch, window pattern, trim details, ceiling height… */
  features: string[];
  /** Existing materials & colors worth relating to (brick, cedar shake, oak floors…). */
  materials: string[];
  /** Scale & proportion notes (two-story mass, low horizontal lines, 36 in door with sidelights…). */
  proportions: string;
  /** Principles a good redesign should follow for this house. */
  designLanguage: string[];
  /** How the space is used / should work (main entry from the driveway side, guests park on the street…). */
  purpose: string[];
}

/** AI understanding of one photo. Coordinates are in photo px. */
export interface SceneMap {
  /** AI-detected category of the photo. */
  category: SpaceType;
  /** e.g. "Street view of a two-story colonial, facing the front door, mid-morning". */
  summary: string;
  viewpoint: string;
  style: string;
  /** Where the yard / room boundaries are, e.g. "Lawn ends at the public sidewalk; boxwood hedge along the right property line". */
  boundaries: string;
  /** Light direction, time of day, shadows. */
  lighting: string;
  /** Which way the main facade / windows face, inferred from shadows ("front faces roughly south-east"). */
  orientation: string;
  architecture: ArchitectureAnalysis;
  zones: SceneZone[];
  paths: ScenePath[];
  /** Notable things to keep unless asked (mature trees, brick, architecture). */
  keep: string[];
  /** Short list of redesign opportunities. */
  opportunities: string[];
  createdAt: number;
  model: string;
}

export const IDEA_KINDS = ['image', 'note', 'product', 'theme'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** Something on the idea board that conveys the look the user wants. */
export interface IdeaItem {
  id: ID;
  kind: IdeaKind;
  /** Inspiration / product image in the blob store (downscaled to ≤ 1024 px). */
  imageId?: ID;
  thumbId?: ID;
  title: string;
  /** What the user likes about it ("love the stone border and the warm lanterns"). */
  note: string;
  /** Dominant colors extracted client-side ('#rrggbb'). */
  colors: string[];
  /** AI description of the image (style, materials, plants, colors) — cached for prompts. */
  aiDescription?: string;
  product?: ProductInfo;
  /** kind 'theme': id of a DesignTheme from the design-knowledge base. */
  themeId?: string;
  /** Spaces this applies to; empty = the whole house. */
  spaceIds: ID[];
  /** Included in generations by default. */
  active: boolean;
  createdAt: number;
}

/**
 * Design elements: the simple building blocks the user composes a rendition
 * from ("Pathway", "Border edging", "Wall paint", "Lighting"…). Each element
 * has choice dimensions (e.g. Pathway → material, stone size, shape, width,
 * edging) whose options carry a visual (swatch) and the prompt text they add.
 */
export const ELEMENT_TYPES = [
  // exterior / landscape
  'pathway',
  'border-edging',
  'planting-bed',
  'lawn',
  'trees-shrubs',
  'patio',
  'driveway',
  'steps',
  'fence',
  'retaining-wall',
  'water-feature',
  'outdoor-lighting',
  'front-door',
  'exterior-paint',
  'roof',
  'porch',
  'garage-door',
  'windows-shutters',
  'outdoor-furniture',
  // interior
  'wall-paint',
  'flooring',
  'ceiling',
  'interior-lighting',
  'cabinets',
  'countertops',
  'backsplash',
  'furniture',
  'window-treatments',
  'decor',
  'fireplace',
  // anything else
  'custom',
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** Swatch shown for an option so choices can be compared at a glance. */
export type OptionVisual =
  | { kind: 'texture'; texture: TextureSpec }
  | { kind: 'color'; hex: string }
  | { kind: 'colors'; hexes: string[] }
  | { kind: 'art'; art: ArtSpec }
  /** Small diagram id rendered by the UI (e.g. 'path-straight', 'path-curved', 'width-3', 'beam-down'). */
  | { kind: 'diagram'; diagram: string }
  /** Image in the blob store (AI preview or user upload). */
  | { kind: 'image'; imageId: ID };

export interface ElementOption {
  id: string;
  label: string;
  /** One line shown under the swatch, e.g. "18–24 in irregular slabs, wide joints". */
  description: string;
  /** Phrase added to the image prompt when chosen, e.g. "large irregular bluestone flagstones (18–24 in) with 2 in moss joints". */
  promptText: string;
  visual?: OptionVisual;
  /** Why this option suits the house / purpose (architecture-grounded), shown to compare options. */
  rationale?: string;
  /** For plant options: can it actually thrive here (zone, sun, water, space)? */
  feasibility?: PlantFeasibility;
}

/** Whether a plant is a realistic choice for this property and spot. */
export interface PlantFeasibility {
  rating: 'good' | 'caution' | 'poor';
  /** Short reasons, e.g. "Zone 5-9 ✓ (you're 7a)", "Needs full sun; this bed is shaded most of the day". */
  reasons: string[];
}

/** A plant used in a generation, with its feasibility for the spot. */
export interface PlantNote {
  name: string;
  botanical?: string;
  rating: PlantFeasibility['rating'];
  notes: string[];
  /** A better-suited alternative when rating isn't 'good'. */
  alternative?: string;
}

export interface ElementDimension {
  id: string;
  label: string;
  /** Question the app asks, e.g. "What size stones?" */
  question: string;
  options: ElementOption[];
  /** Allow picking several options (e.g. plant palette). Default false. */
  multiple?: boolean;
  /** Option id preselected when the element is added. */
  defaultOptionId?: string;
}

export interface ElementDef {
  type: ElementType;
  label: string;
  description: string;
  /** lucide-react icon name for the element tile. */
  icon: string;
  setting: 'exterior' | 'interior' | 'both';
  /** Zone kinds this element usually targets (used to preselect "where"). */
  zoneKinds: ZoneKind[];
  dimensions: ElementDimension[];
}

/** An element the user added to a brief, with their choices. */
export interface ElementSpec {
  id: ID;
  type: ElementType;
  /** e.g. "Front walkway". */
  label: string;
  /** Where it applies: scene zones and/or scene paths (incl. sketched ones). */
  zoneIds: ID[];
  pathIds: ID[];
  /** Dimensions in use (built-in defaults, possibly tailored/extended by AI). */
  dimensions: ElementDimension[];
  /** dimension id -> chosen option ids. */
  choices: Record<string, string[]>;
  /** Free text for this element ("keep the existing lamp post"). */
  note: string;
}

/** What the user is asking for: free text + element building blocks + inspiration. */
export interface DesignBrief {
  prompt: string;
  elements: ElementSpec[];
  /** How plants are shown: as planted, after ~3 years, or at mature size. */
  plantMaturity: 'new' | 'established' | 'mature';
  /** Idea board items to use as inspiration. */
  ideaItemIds: ID[];
  /** Zones allowed to change (union with the elements' zones). Empty + scope 'whole' = anything. */
  targetZoneIds: ID[];
  scope: 'zones' | 'whole';
}

export function emptyBrief(): DesignBrief {
  return { prompt: '', elements: [], plantMaturity: 'established', ideaItemIds: [], targetZoneIds: [], scope: 'zones' };
}

/**
 * Design knowledge: curated architectural styles, design themes and
 * purpose-driven guidance per element. Grounds AI prompts and the UI in real
 * architectural sense (style, era, proportion, materials, function).
 */
export interface ArchitecturalStyle {
  id: string;
  name: string;
  era: string;
  setting: 'exterior' | 'interior' | 'both';
  /** Visual cues to recognize it. */
  identify: string[];
  characteristics: string[];
  /** Typical, historically appropriate palettes (3-5 hexes each: body, trim, accent/door…). */
  palettes: { name: string; hexes: string[] }[];
  materials: string[];
  /** Landscape / planting approaches that suit it. */
  landscape: string[];
  lighting: string[];
  /** Common mistakes that clash with the style. */
  avoid: string[];
  /** DesignTheme ids that pair well. */
  themes: string[];
}

export interface DesignTheme {
  id: string;
  name: string;
  setting: 'exterior' | 'interior' | 'both';
  /** What the theme is for — the purpose it serves (e.g. "low water, low upkeep in hot dry climates"). */
  purpose: string;
  description: string;
  principles: string[];
  palette: string[];
  materials: string[];
  plants: string[];
  lighting: string[];
  /** ArchitecturalStyle ids it suits best. */
  suits: string[];
  /** Climate / zone notes (e.g. "zones 7-10, full sun"). */
  climate?: string;
  /** Compact phrase used in image prompts. */
  promptHint: string;
}

/** Purpose and rules of thumb for one element type (e.g. pathway: 4-5 ft primary entry walk…). */
export interface ElementGuidance {
  type: ElementType;
  purpose: string;
  rulesOfThumb: string[];
  /** How the choice should relate to the architecture. */
  relateToArchitecture: string[];
}

/** One generated image. */
export interface Variation {
  id: ID;
  imageId: ID;
  thumbId: ID;
  width: number;
  height: number;
  /** Short name, e.g. "Curved flagstone path + lavender border". */
  title: string;
  /** The exact instruction sent to the image model. */
  brief: string;
  /** In compare runs: the option this variation shows. */
  optionId?: string;
  optionLabel?: string;
  favorite: boolean;
  createdAt: number;
}

/** One run: Claude's plan plus a batch of variations. */
export interface Generation {
  id: ID;
  createdAt: number;
  /** Snapshot of the brief that produced it (re-run / fine-tune from here). */
  brief: DesignBrief;
  /** 'variations' = N different takes on the brief; 'compare' = one variation per option of one dimension, all else fixed. */
  mode: 'variations' | 'compare';
  compare?: { elementId: ID; dimensionId: string; optionIds: string[] };
  /** Variation (of this photo) this run started from; undefined = the original photo. */
  baseVariationId?: ID;
  /** Claude's interpretation: what will change and what stays. */
  plan: string;
  /** Plants the plan uses, with feasibility for this property (exterior runs). */
  plantNotes?: PlantNote[];
  provider: string;
  model: string;
  variations: Variation[];
  status: 'running' | 'done' | 'partial' | 'failed';
  error?: string;
}

export const RECOMMENDATION_CATEGORIES = [
  'landscaping',
  'hardscape',
  'paint',
  'lighting',
  'architecture',
  'interior',
  'decor',
  'other',
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export interface Recommendation {
  id: ID;
  title: string;
  /** Ready-to-run prompt. */
  prompt: string;
  why: string;
  category: RecommendationCategory;
  targetZoneIds: ID[];
  /** Element to add to the brief when the user picks this, if one fits. */
  elementType?: ElementType;
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
  /** DEPRECATED (pre-studio analysis); superseded by `scene`. */
  analysis?: SpaceAnalysis;
  /** AI scene understanding (categorization, zones, paths). */
  scene?: SceneMap;
  /** The brief being composed in the Studio for this photo. */
  draft?: DesignBrief;
  /** Prompt runs, newest first. */
  generations: Generation[];
  /** Latest AI recommendations for this photo. */
  recommendations?: { items: Recommendation[]; createdAt: number; baseVariationId?: ID };
  /** Fine-tune (hand-tool) design options. */
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

/** Growing conditions for the property — used to keep plant choices feasible. */
export interface ClimateProfile {
  /** USDA hardiness zone, e.g. "7a". */
  hardinessZone: string;
  /** One or two sentences: climate type, summer heat, humidity, rainfall pattern. */
  summary: string;
  lastFrost?: string; // e.g. "mid-April"
  firstFrost?: string; // e.g. "late October"
  annualRainfallIn?: number;
  /** Typical soils, deer pressure, watering restrictions, invasive species to avoid… */
  notes: string[];
  source: 'ai' | 'user';
  updatedAt: number;
}

export interface ProjectLocation {
  zip?: string;
  /** USDA hardiness zone like "7a". */
  hardinessZone?: string;
  /** Free text: climate, HOA rules, sun orientation… */
  notes?: string;
  climate?: ClimateProfile;
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
  /** Inspiration that conveys the overall look (images, notes, real products). */
  ideaBoard: IdeaItem[];
  /** DEPRECATED — the shopping list was dropped; always []. */
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

export const STORE_KINDS = ['home-depot', 'lowes', 'nursery', 'other'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

export const STORE_LABELS: Record<StoreKind, string> = {
  'home-depot': 'The Home Depot',
  lowes: "Lowe's",
  nursery: 'Nursery',
  other: 'Store',
};

/** A real, purchasable product an asset was created from (search result or pasted link). */
export interface ProductInfo {
  /** Display name of the seller, e.g. "The Home Depot", "Lowe's", "Nature Hills Nursery". */
  store: string;
  storeKind: StoreKind;
  /** Product page. */
  url: string;
  brand?: string;
  /** Price in USD when known (as found; may have changed). */
  priceUsd?: number;
  /** Price as displayed, e.g. "$24.98 / 3 gal". */
  priceText?: string;
  /** Original product image URL (the asset's own image is the cut-out copy in the blob store). */
  imageUrl?: string;
  /** Key specs, e.g. ["2700K", "800 lumens", "Zones 5-9", "3 gal container"]. */
  specs: string[];
  /** When the price / details were retrieved (ms epoch). */
  retrievedAt: number;
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
  /** Set when the asset is a real store product (search result or pasted link). */
  product?: ProductInfo;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Asset list (shopping / materials list) — DEPRECATED: the shopping-list feature
// was dropped after the user interview. Kept only until the server's legacy
// endpoint is removed; do not build UI or logic on it.
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
