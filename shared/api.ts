/**
 * HTTP contract between the web app (src/lib/api.ts) and the API server (server/).
 *
 * Zod schemas double as Claude structured-output formats on the server
 * (betaZodOutputFormat), so response schemas follow structured-output rules:
 * - every field required; use `.nullable()` instead of `.optional()`
 * - no numeric min/max constraints (describe ranges in `.describe()` instead)
 */
import { z } from 'zod';
import {
  ELEMENT_TYPES,
  RECOMMENDATION_CATEGORIES,
  TEXTURE_PATTERNS,
  ZONE_KINDS,
  STORE_KINDS,
  ASSET_CATEGORIES,
  ASSET_LIST_CATEGORIES,
  PAINT_FINISHES,
  SPACE_TYPES,
  SURFACE_KINDS,
  TIMES_OF_DAY,
} from './types';

export const API_PATHS = {
  health: '/api/health',
  analyze: '/api/analyze',
  suggest: '/api/suggest',
  assetList: '/api/asset-list',
  generateAsset: '/api/generate-asset',
  render: '/api/render',
  productSearch: '/api/products/search',
  productFromUrl: '/api/products/from-url',
  /** GET ?url=<encoded image url> — server-side image fetch (CORS-free, SSRF-guarded). */
  productImage: '/api/products/image',
  // Studio
  scene: '/api/studio/scene',
  climate: '/api/studio/climate',
  elementOptions: '/api/studio/element-options',
  recommend: '/api/studio/recommend',
  describeIdea: '/api/studio/describe-idea',
  plan: '/api/studio/plan',
  renderVariation: '/api/studio/render-variation',
  // Manual hand-off helpers
  /** GET → { available, dir }; POST { on: boolean } starts / stops watching the Downloads folder. */
  handoffWatch: '/api/handoff/watch',
  /** GET (Server-Sent Events): `file` events { id, name, size, mtime } for new images while watching. */
  handoffEvents: '/api/handoff/events',
  /** GET ?id=… → the detected image bytes. */
  handoffFile: '/api/handoff/file',
  /** POST { url } → image bytes (https only, SSRF-guarded) for images dragged in from another tab. */
  handoffFetchUrl: '/api/handoff/fetch-url',
  // Site data
  /** POST { lat, lon } → SiteProfile (NOAA frost dates + USDA soil), cached. */
  siteProfile: '/api/site/profile',
} as const;

/** Max size of JSON request bodies accepted by the server. */
export const MAX_BODY_BYTES = 20 * 1024 * 1024;

const SpaceTypeZ = z.enum(SPACE_TYPES);
const SurfaceKindZ = z.enum(SURFACE_KINDS);
const PaintFinishZ = z.enum(PAINT_FINISHES);
const TimeOfDayZ = z.enum(TIMES_OF_DAY);
const AssetListCategoryZ = z.enum(ASSET_LIST_CATEGORIES);
const AssetCategoryZ = z.enum(ASSET_CATEGORIES);

/** A data URL: "data:image/jpeg;base64,...." (jpeg/png/webp). */
const DataUrlZ = z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Expected a base64 image data URL');

const HexZ = z.string().describe("Hex color like '#a1b2c3'");

const NormPointZ = z
  .object({
    x: z.number().describe('0..1 from the left edge of the photo'),
    y: z.number().describe('0..1 from the top edge of the photo'),
  })
  .describe('Approximate position in the photo, normalized 0..1');

const LocationZ = z.object({
  zip: z.string().nullable(),
  hardinessZone: z.string().nullable(),
  notes: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export const ImageProviderIdZ = z.enum(['openai', 'gemini']);
export type ImageProviderId = z.infer<typeof ImageProviderIdZ>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  ai: z.object({ enabled: z.boolean(), model: z.string().nullable() }),
  /** Default image provider (legacy single-provider field). */
  imageProvider: z.object({ enabled: z.boolean(), name: z.string().nullable(), model: z.string().nullable() }),
  /** Every configured image provider (Studio lets the user pick). */
  imageProviders: z
    .array(z.object({ id: ImageProviderIdZ, name: z.string(), model: z.string(), isDefault: z.boolean() }))
    .optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/analyze — describe a photo of a space
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  image: DataUrlZ,
  spaceType: SpaceTypeZ.nullable(),
  notes: z.string().max(2000).nullable(),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const SpaceAnalysisResultSchema = z.object({
  spaceType: SpaceTypeZ,
  summary: z.string().describe('2-3 sentence description of the space as photographed'),
  style: z.string().describe('Current style in a few words'),
  surfaces: z.array(
    z.object({
      surface: SurfaceKindZ,
      description: z.string(),
      currentColorHex: HexZ.nullable(),
      condition: z.string().nullable(),
    }),
  ),
  lighting: z.object({
    natural: z.string(),
    artificial: z.string(),
    issues: z.array(z.string()),
  }),
  landscaping: z
    .object({ features: z.array(z.string()), issues: z.array(z.string()) })
    .nullable()
    .describe('Only for exterior photos; null for interiors'),
  opportunities: z.array(z.string()).describe('Concrete redesign opportunities, most impactful first'),
});
export type SpaceAnalysisResult = z.infer<typeof SpaceAnalysisResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/suggest — propose a redesign for one photo
// ---------------------------------------------------------------------------

export const SuggestRequestSchema = z.object({
  image: DataUrlZ,
  spaceType: SpaceTypeZ,
  /** Style direction, e.g. "warm modern", "coastal", "xeriscape". */
  style: z.string().max(300),
  /** Free-form wishes: "make it brighter", "low maintenance", "kid friendly". */
  brief: z.string().max(4000).nullable(),
  budgetUsd: z.number().nullable(),
  location: LocationZ.nullable(),
  /** Regions the user has already outlined, so the AI can assign treatments to them. */
  regions: z.array(z.object({ id: z.string(), name: z.string(), surface: SurfaceKindZ })),
});
export type SuggestRequest = z.infer<typeof SuggestRequestSchema>;

export const AssetListDraftSchema = z.object({
  name: z.string(),
  category: AssetListCategoryZ,
  quantity: z.number(),
  unit: z.string().describe('gal, each, sq ft, cu yd, bag, lin ft, flat, hour'),
  unitCostUsd: z.number().nullable().describe('Typical US retail price per unit'),
  specs: z.string().describe('Short spec line: finish, size, color temperature, container size…'),
  vendor: z.string().nullable().describe('Kind of store or brand to look at, if relevant'),
  notes: z.string(),
  hex: HexZ.nullable().describe('Paint color for paint rows, else null'),
  refId: z.string().nullable().describe('Catalog id when the item matches a catalog entry, else null'),
  spaceNames: z.array(z.string()).describe('Which spaces this is for; empty for whole project'),
});
export type AssetListDraft = z.infer<typeof AssetListDraftSchema>;

export const DesignSuggestionSchema = z.object({
  title: z.string(),
  concept: z.string().describe('2-4 sentences on the overall direction'),
  palette: z.array(
    z.object({
      role: z.string().describe("e.g. 'main walls', 'trim', 'front door', 'siding'"),
      name: z.string(),
      hex: HexZ,
      finish: PaintFinishZ,
      brandMatch: z.string().nullable().describe('A comparable real-world paint color to check in store, or null'),
    }),
  ),
  regionTreatments: z.array(
    z.object({
      regionId: z.string(),
      kind: z.enum(['paint', 'material', 'none']),
      hex: HexZ.nullable(),
      colorName: z.string().nullable(),
      finish: PaintFinishZ.nullable(),
      materialId: z.string().nullable().describe('Must be an id from the materials catalog'),
      reason: z.string(),
    }),
  ),
  lighting: z.object({
    timeOfDay: TimeOfDayZ.describe('Best time of day to preview this design'),
    kelvin: z.number().describe('Ambient white balance 2200..6500'),
    fixtures: z.array(
      z.object({
        assetId: z.string().nullable().describe('Fixture id from the catalog, or null'),
        name: z.string(),
        quantity: z.number(),
        kelvin: z.number(),
        placement: z.string(),
        positions: z.array(NormPointZ).describe('Where to place each fixture in the photo; may be empty'),
      }),
    ),
  }),
  plants: z.array(
    z.object({
      assetId: z.string().nullable().describe('Plant id from the catalog, or null'),
      name: z.string(),
      botanical: z.string().nullable(),
      quantity: z.number(),
      placement: z.string(),
      why: z.string(),
      positions: z.array(NormPointZ).describe('Ground-contact points in the photo; may be empty'),
    }),
  ),
  decor: z.array(
    z.object({
      assetId: z.string().nullable(),
      name: z.string(),
      quantity: z.number(),
      placement: z.string(),
      positions: z.array(NormPointZ),
    }),
  ),
  assetList: z.array(AssetListDraftSchema),
  tips: z.array(z.string()),
  estimatedBudget: z.object({ lowUsd: z.number(), highUsd: z.number() }),
});
export type DesignSuggestion = z.infer<typeof DesignSuggestionSchema>;

// ---------------------------------------------------------------------------
// POST /api/asset-list — build / enrich the project's shopping list
// ---------------------------------------------------------------------------

export const AssetListRequestSchema = z.object({
  projectName: z.string(),
  location: LocationZ.nullable(),
  budgetUsd: z.number().nullable(),
  style: z.string().nullable(),
  brief: z.string().max(4000).nullable(),
  /** Text summary of every space/design: regions + treatments + areas, placed objects, lights. */
  designSummary: z.string().max(60000),
  /** Current list so the AI can complete it instead of duplicating it. */
  existingItems: z.array(
    z.object({ name: z.string(), category: AssetListCategoryZ, quantity: z.number(), unit: z.string() }),
  ),
});
export type AssetListRequest = z.infer<typeof AssetListRequestSchema>;

export const AssetListResultSchema = z.object({
  items: z.array(AssetListDraftSchema).describe('Items to ADD; do not repeat existing items'),
  notes: z.array(z.string()).describe('Planning notes: sequencing, permits, seasonality, hidden costs'),
});
export type AssetListResult = z.infer<typeof AssetListResultSchema>;

// ---------------------------------------------------------------------------
// POST /api/generate-asset — create a new placeable asset from a description
// ---------------------------------------------------------------------------

export const GenerateAssetRequestSchema = z.object({
  description: z.string().min(2).max(1000),
  category: AssetCategoryZ,
  /** 'vector' = Claude draws an SVG (always available when AI is on);
   *  'photo'  = image provider renders a transparent PNG (needs IMAGE_PROVIDER). */
  mode: z.enum(['vector', 'photo']),
});
export type GenerateAssetRequest = z.infer<typeof GenerateAssetRequestSchema>;

export const GeneratedAssetMetaSchema = z.object({
  name: z.string(),
  category: AssetCategoryZ,
  subcategory: z.string().nullable(),
  description: z.string(),
  realHeightFt: z.number().describe('Typical real-world height in feet'),
  tags: z.array(z.string()),
  costLowUsd: z.number().nullable(),
  costHighUsd: z.number().nullable(),
});
export type GeneratedAssetMeta = z.infer<typeof GeneratedAssetMetaSchema>;

export const GeneratedAssetSchema = GeneratedAssetMetaSchema.extend({
  /** Present for mode 'vector': standalone SVG markup, transparent background. */
  svg: z.string().nullable(),
  /** Present for mode 'photo': PNG data URL with transparent background. */
  image: z.string().nullable(),
  aspect: z.number(),
});
export type GeneratedAsset = z.infer<typeof GeneratedAssetSchema>;

// ---------------------------------------------------------------------------
// POST /api/render — photoreal AI render of the current design (image provider)
// ---------------------------------------------------------------------------

export const RenderRequestSchema = z.object({
  /** The current composited preview (or original photo). */
  image: DataUrlZ,
  /** Optional PNG mask: OPAQUE where the image must be kept, TRANSPARENT where it may change. */
  mask: DataUrlZ.nullable(),
  /** Text description of the design (treatments, fixtures, plants) built by the client. */
  designSummary: z.string().max(20000),
  instructions: z.string().max(2000).nullable(),
  strength: z.enum(['subtle', 'balanced', 'bold']),
});
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export const RenderResponseSchema = z.object({
  image: z.string().describe('PNG/JPEG data URL'),
  prompt: z.string(),
  provider: z.string(),
});
export type RenderResponse = z.infer<typeof RenderResponseSchema>;

// ---------------------------------------------------------------------------
// Real store products — POST /api/products/search, POST /api/products/from-url,
// GET /api/products/image?url=…
// Search uses Claude with web search restricted to the chosen stores; from-url
// reads a pasted product page (structured data / meta tags, Claude fallback).
// ---------------------------------------------------------------------------

const StoreKindZ = z.enum(STORE_KINDS);

export const ProductResultSchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  /** Seller display name, e.g. "The Home Depot", "Lowe's", "Nature Hills Nursery". */
  store: z.string(),
  storeKind: StoreKindZ,
  url: z.string().describe('Product page URL'),
  imageUrl: z.string().nullable().describe('Direct URL of the main product image (jpg/png/webp)'),
  priceUsd: z.number().nullable(),
  priceText: z.string().nullable().describe('Price as shown, e.g. "$24.98 / 3 gal"'),
  category: AssetCategoryZ,
  description: z.string().describe('One or two sentences'),
  realHeightFt: z.number().nullable().describe('Approximate real height in feet (fixture height, plant size at purchase or mature), for scaling on the photo'),
  specs: z.array(z.string()).describe('Key specs: color temperature, lumens, finish, container size, zones, sun, mature size…'),
  plant: z
    .object({
      botanical: z.string().nullable(),
      sun: z.string().nullable(),
      water: z.string().nullable(),
      zones: z.string().nullable().describe('e.g. "5-9"'),
      matureSize: z.string().nullable(),
    })
    .nullable(),
  light: z
    .object({ kelvin: z.number().nullable(), lumens: z.number().nullable(), indoor: z.boolean(), outdoor: z.boolean() })
    .nullable(),
});
export type ProductResult = z.infer<typeof ProductResultSchema>;

export const ProductSearchRequestSchema = z.object({
  query: z.string().min(2).max(300),
  category: AssetCategoryZ,
  stores: z.array(StoreKindZ).min(1),
  maxPriceUsd: z.number().nullable(),
  location: LocationZ.nullable(),
  /** Extra context, e.g. "north-facing front bed", "over a kitchen island, 36 in wide". */
  context: z.string().max(1000).nullable(),
});
export type ProductSearchRequest = z.infer<typeof ProductSearchRequestSchema>;

export const ProductSearchResultSchema = z.object({
  products: z.array(ProductResultSchema),
  notes: z.array(z.string()).describe('Caveats: availability, regional stock, price checked date…'),
});
export type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;

export const ProductFromUrlRequestSchema = z.object({
  url: z.string().url().max(2000),
});
export type ProductFromUrlRequest = z.infer<typeof ProductFromUrlRequestSchema>;

export const ProductFromUrlResponseSchema = z.object({
  product: ProductResultSchema,
  /** How the details were obtained. 'partial' = some fields could not be read (site blocked); ask the user to fill them in. */
  method: z.enum(['structured-data', 'ai', 'partial']),
});
export type ProductFromUrlResponse = z.infer<typeof ProductFromUrlResponseSchema>;

// ---------------------------------------------------------------------------
// Studio — scene understanding, element options, recommendations, idea
// descriptions, variation planning and rendering. Coordinates exchanged with
// the AI are NORMALIZED (0..1 of photo width/height); the client converts.
// ---------------------------------------------------------------------------

const ZoneKindZ = z.enum(ZONE_KINDS);
const ElementTypeZ = z.enum(ELEMENT_TYPES);

/** POST /api/studio/scene — categorize the photo and map its zones and paths. */
export const SceneRequestSchema = z.object({
  image: DataUrlZ,
  width: z.number(),
  height: z.number(),
  spaceTypeHint: SpaceTypeZ.nullable(),
  notes: z.string().max(2000).nullable(),
});
export type SceneRequest = z.infer<typeof SceneRequestSchema>;

export const SceneResultSchema = z.object({
  category: SpaceTypeZ.describe('Best category for this photo'),
  summary: z.string(),
  viewpoint: z.string(),
  style: z.string(),
  boundaries: z.string().describe('Where the yard / room boundaries are and what marks them'),
  lighting: z.string(),
  orientation: z.string().describe('Which way the facade / windows face, inferred from shadows and sun'),
  architecture: z.object({
    style: z.string().describe('Specific architectural style, e.g. "Center-hall Colonial Revival"'),
    styleId: z.string().nullable().describe('Matching id from the provided style list, or null'),
    era: z.string().nullable(),
    features: z.array(z.string()),
    materials: z.array(z.string()),
    proportions: z.string(),
    designLanguage: z.array(z.string()).describe('Principles a redesign should follow for this house'),
    purpose: z.array(z.string()).describe('How the space is used / should function'),
  }),
  zones: z.array(
    z.object({
      kind: ZoneKindZ,
      label: z.string(),
      description: z.string(),
      polygon: z.array(NormPointZ).describe('Outline, clockwise, 4-24 points, tight to the visible area'),
      editable: z.boolean(),
      sun: z.enum(['full-sun', 'part-sun', 'shade']).nullable().describe('Estimated sun exposure for ground/planting zones, else null'),
    }),
  ),
  paths: z.array(
    z.object({
      label: z.string(),
      from: z.string(),
      to: z.string(),
      description: z.string(),
      points: z.array(NormPointZ).describe('Centerline from start to end, 2-12 points'),
      widthFraction: z.number().describe('Path width at its nearest point as a fraction of photo width'),
    }),
  ),
  keep: z.array(z.string()),
  opportunities: z.array(z.string()),
});
export type SceneResult = z.infer<typeof SceneResultSchema>;

const PlantFeasibilityZ = z.object({
  rating: z.enum(['good', 'caution', 'poor']),
  reasons: z.array(z.string()),
});

const PlantNoteZ = z.object({
  name: z.string(),
  botanical: z.string().nullable(),
  rating: z.enum(['good', 'caution', 'poor']),
  notes: z.array(z.string()).describe('Zone fit, sun fit, water, mature size vs space, deer, invasiveness'),
  alternative: z.string().nullable().describe('Better-suited alternative when rating is not good'),
});

/** POST /api/studio/climate — growing conditions from a ZIP code / zone (Claude's knowledge, not a live lookup). */
export const ClimateRequestSchema = z.object({
  zip: z.string().max(10).nullable(),
  hardinessZone: z.string().max(4).nullable(),
  notes: z.string().max(1000).nullable(),
});
export type ClimateRequest = z.infer<typeof ClimateRequestSchema>;

export const ClimateResultSchema = z.object({
  hardinessZone: z.string(),
  summary: z.string(),
  lastFrost: z.string().nullable(),
  firstFrost: z.string().nullable(),
  annualRainfallIn: z.number().nullable(),
  notes: z.array(z.string()).describe('Soils, deer pressure, watering restrictions, invasive species to avoid, native plant resources'),
});
export type ClimateResult = z.infer<typeof ClimateResultSchema>;

/** Option visual as the AI may describe it (texture from our pattern set, or colors). */
export const OptionVisualDraftSchema = z.object({
  kind: z.enum(['texture', 'color', 'none']),
  pattern: z.enum(TEXTURE_PATTERNS).nullable(),
  colors: z.array(HexZ).describe('1-4 colors: the swatch color or the texture palette'),
  unitWidthIn: z.number().nullable(),
  unitHeightIn: z.number().nullable(),
});
export type OptionVisualDraft = z.infer<typeof OptionVisualDraftSchema>;

export const ElementDimensionDraftSchema = z.object({
  id: z.string().describe('kebab-case'),
  label: z.string(),
  question: z.string(),
  multiple: z.boolean(),
  options: z.array(
    z.object({
      id: z.string().describe('kebab-case'),
      label: z.string(),
      description: z.string(),
      promptText: z.string(),
      visual: OptionVisualDraftSchema,
      rationale: z.string().describe('Why this option suits this house and purpose (style, proportion, function)'),
      feasibility: PlantFeasibilityZ.nullable().describe('For plant options only (zone, sun, water, mature size vs space); else null'),
    }),
  ),
});
export type ElementDimensionDraft = z.infer<typeof ElementDimensionDraftSchema>;

/** POST /api/studio/element-options — tailor an element's choices to this photo. */
export const ElementOptionsRequestSchema = z.object({
  elementType: ElementTypeZ,
  elementLabel: z.string(),
  image: DataUrlZ.nullable(),
  sceneSummary: z.string().max(8000),
  zoneLabels: z.array(z.string()),
  ideas: z.array(z.string()).describe('Idea board descriptions / notes'),
  location: LocationZ.nullable(),
  climate: z.string().max(4000).nullable(),
  /** Built-in dimensions so the AI refines rather than reinvents them. */
  existing: z.array(z.object({ id: z.string(), label: z.string(), optionLabels: z.array(z.string()) })),
  /** Optional user question, e.g. "what stone sizes would suit a cottage look?" */
  ask: z.string().max(1000).nullable(),
});
export type ElementOptionsRequest = z.infer<typeof ElementOptionsRequestSchema>;

export const ElementOptionsResultSchema = z.object({
  dimensions: z.array(ElementDimensionDraftSchema),
  tips: z.array(z.string()),
});
export type ElementOptionsResult = z.infer<typeof ElementOptionsResultSchema>;

/** POST /api/studio/recommend — ideas for this photo given the scene and idea board. */
export const RecommendRequestSchema = z.object({
  image: DataUrlZ,
  sceneSummary: z.string().max(8000),
  zones: z.array(z.object({ id: z.string(), kind: ZoneKindZ, label: z.string() })),
  ideas: z.array(z.string()),
  location: LocationZ.nullable(),
  climate: z.string().max(4000).nullable(),
  focus: z.string().max(1000).nullable(),
});
export type RecommendRequest = z.infer<typeof RecommendRequestSchema>;

export const RecommendResultSchema = z.object({
  recommendations: z.array(
    z.object({
      title: z.string(),
      prompt: z.string(),
      why: z.string(),
      category: z.enum(RECOMMENDATION_CATEGORIES),
      targetZoneIds: z.array(z.string()).describe('Only ids from the provided zones'),
      elementType: ElementTypeZ.nullable(),
    }),
  ),
});
export type RecommendResult = z.infer<typeof RecommendResultSchema>;

/** POST /api/studio/describe-idea — read an inspiration image. */
export const DescribeIdeaRequestSchema = z.object({
  image: DataUrlZ,
  note: z.string().max(2000).nullable(),
});
export type DescribeIdeaRequest = z.infer<typeof DescribeIdeaRequestSchema>;

export const DescribeIdeaResultSchema = z.object({
  title: z.string().describe('2-6 words'),
  description: z.string().describe('Style, materials, colors, plants, lighting — what makes the look, in 2-4 sentences'),
  styleTags: z.array(z.string()),
});
export type DescribeIdeaResult = z.infer<typeof DescribeIdeaResultSchema>;

/** POST /api/studio/plan — turn a brief into N variation instructions (or one per compared option). */
export const PlanRequestSchema = z.object({
  /** Base image the variations start from (original photo or a chosen variation). */
  image: DataUrlZ,
  sceneSummary: z.string().max(8000),
  zones: z.array(
    z.object({
      id: z.string(),
      kind: ZoneKindZ,
      label: z.string(),
      description: z.string(),
      sun: z.enum(['full-sun', 'part-sun', 'shade']).nullable(),
    }),
  ),
  paths: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  location: LocationZ.nullable(),
  /** Climate profile summary (zone, frost, rainfall, notes) for plant feasibility. */
  climate: z.string().max(4000).nullable(),
  brief: z.object({
    prompt: z.string().max(4000),
    scope: z.enum(['zones', 'whole']),
    plantMaturity: z.enum(['new', 'established', 'mature']),
    /** How freely variations may reinterpret the brief (default balanced). */
    strictness: z.enum(['strict', 'balanced', 'creative']).optional(),
    targetZoneLabels: z.array(z.string()),
    elements: z.array(
      z.object({
        type: ElementTypeZ,
        label: z.string(),
        where: z.array(z.string()).describe('Zone / path labels'),
        choices: z.array(z.object({ dimension: z.string(), options: z.array(z.string()) })).describe('Chosen option prompt texts per dimension'),
        note: z.string(),
      }),
    ),
  }),
  ideas: z.array(z.string()),
  /** Up to 3 inspiration images. */
  ideaImages: z.array(DataUrlZ).max(3),
  count: z.number(),
  compare: z
    .object({
      elementLabel: z.string(),
      dimensionLabel: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string(), promptText: z.string() })),
    })
    .nullable(),
  /** "More like this" / refine: the variation we start from and what to change. */
  refine: z.object({ title: z.string(), brief: z.string(), feedback: z.string().nullable() }).nullable(),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResultSchema = z.object({
  plan: z.string().describe('What will change and what stays, 1-3 sentences'),
  plants: z.array(PlantNoteZ).describe('Every plant the variations use, with feasibility for this property; empty for interiors'),
  variations: z.array(
    z.object({
      title: z.string().describe('3-7 words'),
      brief: z.string().describe('Complete, self-contained image-edit instruction for this variation'),
      optionId: z.string().nullable().describe('For compare runs: which option this variation shows'),
    }),
  ),
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

/** POST /api/studio/render-variation — one image from one instruction. */
export const RenderVariationRequestSchema = z.object({
  image: DataUrlZ,
  /** PNG, same size as `image`: OPAQUE = keep, TRANSPARENT = may change (OpenAI convention). Null = whole image. */
  mask: DataUrlZ.nullable(),
  brief: z.string().max(8000),
  references: z.array(DataUrlZ).max(3),
  provider: ImageProviderIdZ.nullable(),
  quality: z.enum(['draft', 'standard', 'high']),
});
export type RenderVariationRequest = z.infer<typeof RenderVariationRequestSchema>;

export const RenderVariationResultSchema = z.object({
  image: z.string().describe('PNG/JPEG data URL'),
  provider: ImageProviderIdZ,
  model: z.string(),
});
export type RenderVariationResult = z.infer<typeof RenderVariationResultSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum([
      'bad_request',
      'unauthorized',
      'ai_disabled',
      'image_provider_disabled',
      'refused',
      'rate_limited',
      'upstream_error',
      'payload_too_large',
      'internal',
    ]),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
export type ApiErrorCode = ApiErrorBody['error']['code'];
