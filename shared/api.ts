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

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  ai: z.object({ enabled: z.boolean(), model: z.string().nullable() }),
  imageProvider: z.object({ enabled: z.boolean(), name: z.string().nullable(), model: z.string().nullable() }),
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
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum([
      'bad_request',
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
