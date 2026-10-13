/**
 * Real store products (Home Depot, Lowe's, nurseries): search, import from a
 * pasted link, fetch the product image, and turn a product into a placeable
 * library asset. Talks to the API server (see shared/api.ts §Real store products).
 */
import {
  API_PATHS,
  ProductFromUrlRequestSchema,
  ProductFromUrlResponseSchema,
  ProductSearchRequestSchema,
  ProductSearchResultSchema,
} from '../../shared/api';
import type { ProductResult, ProductSearchRequest, ProductSearchResult } from '../../shared/api';
import { newId } from '../../shared/ids';
import type {
  AssetCategory,
  AssetDef,
  LightBeam,
  LightInfo,
  PlantInfo,
  PlantType,
  ProductInfo,
  SunExposure,
  WaterNeed,
} from '../../shared/types';
import { STUDIO_TIMEOUTS_MS, studioGetBlob, studioPost } from './studio';

/** AI web search limited to the requested stores. Throws ApiError (code 'ai_disabled' when AI is off). */
export async function searchProducts(req: ProductSearchRequest, signal?: AbortSignal): Promise<ProductSearchResult> {
  const { data } = await studioPost(
    API_PATHS.productSearch,
    ProductSearchRequestSchema,
    req,
    ProductSearchResultSchema,
    STUDIO_TIMEOUTS_MS.productSearch,
    signal,
  );
  return data;
}

/**
 * Reads a pasted product link. Works without AI for pages with structured data;
 * `method: 'partial'` means some fields are missing and the user should fill them in.
 */
export async function productFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<{ product: ProductResult; method: 'structured-data' | 'ai' | 'partial' }> {
  const { data } = await studioPost(
    API_PATHS.productFromUrl,
    ProductFromUrlRequestSchema,
    { url: url.trim() },
    ProductFromUrlResponseSchema,
    STUDIO_TIMEOUTS_MS.productFromUrl,
    signal,
  );
  return data;
}

/** Downloads a product image through the server (avoids CORS). */
export function fetchProductImage(imageUrl: string, signal?: AbortSignal): Promise<Blob> {
  return studioGetBlob(`${API_PATHS.productImage}?url=${encodeURIComponent(imageUrl)}`, STUDIO_TIMEOUTS_MS.productImage, signal);
}

// ---------------------------------------------------------------------------
// Product → library asset
// ---------------------------------------------------------------------------

/** Typical real height (ft) when the product doesn't say, so it lands at a sensible size on the photo. */
const DEFAULT_HEIGHT_FT: Record<AssetCategory, number> = {
  plant: 2,
  lighting: 1.5,
  decor: 2,
  furniture: 3,
  hardscape: 1,
  other: 2,
};

const PLANT_TYPE_WORDS: [PlantType, RegExp][] = [
  ['houseplant', /\b(houseplant|indoor plant|monstera|pothos|philodendron|fiddle[- ]leaf|snake plant|peace lily|calathea)\b/i],
  ['succulent', /\b(succulent|cactus|cacti|agave|sedum|echeveria|aloe|yucca)\b/i],
  ['fern', /\bfern\b/i],
  ['vine', /\b(vine|climbing|clematis|wisteria|ivy|jasmine|honeysuckle)\b/i],
  ['grass', /\b(ornamental grass|grass|sedge|carex|miscanthus|panicum|pennisetum|fescue)\b/i],
  ['groundcover', /\b(groundcover|ground cover|creeping|vinca|pachysandra|ajuga)\b/i],
  ['hedge', /\b(hedge|privet|arborvitae|thuja)\b/i],
  ['tree', /\b(tree|maple|oak|birch|dogwood|redbud|magnolia|cherry|crape myrtle|crepe myrtle|spruce|pine|fir)\b/i],
  ['shrub', /\b(shrub|bush|boxwood|hydrangea|azalea|rhododendron|holly|viburnum|spirea|rose|lilac|juniper)\b/i],
  ['annual', /\b(annual|petunia|marigold|impatiens|begonia|zinnia)\b/i],
  ['perennial', /\b(perennial|hosta|lavender|salvia|coneflower|echinacea|daylily|peony|catmint|nepeta|black-eyed susan|rudbeckia|astilbe|heuchera|coreopsis)\b/i],
];

function guessPlantType(text: string): PlantType {
  for (const [type, re] of PLANT_TYPE_WORDS) if (re.test(text)) return type;
  return 'perennial';
}

/** "Full sun to part shade" → ['full-sun', 'part-sun']. Unknown → full and part sun (the common case). */
export function parseSun(text: string | null | undefined): SunExposure[] {
  const t = (text ?? '').toLowerCase();
  const full = /full[\s-]*sun|sunny/.test(t);
  const part = /part(ial)?[\s-]*(sun|shade)|dappled|filtered|morning sun|afternoon shade/.test(t);
  const shade = /(full|deep|heavy|dense)[\s-]*shade/.test(t) || (/\bshade\b/.test(t) && !part && !/shade[\s-]*tolerant/.test(t));
  const out: SunExposure[] = [];
  if (full) out.push('full-sun');
  if (part) out.push('part-sun');
  if (shade) out.push('shade');
  return out.length ? out : ['full-sun', 'part-sun'];
}

export function parseWater(text: string | null | undefined): WaterNeed {
  const t = (text ?? '').toLowerCase();
  if (/\b(low|drought|dry|xeric|minimal)\b/.test(t)) return 'low';
  if (/\b(high|wet|moist|boggy|consistent(ly)? moist|plenty)\b/.test(t)) return 'high';
  return 'medium';
}

/** "5-9" / "Zones 4 to 8" / "3a-7b" → { min, max }. */
export function parseZones(text: string | null | undefined): { min: number; max: number } | null {
  const m = /(\d{1,2})\s*[ab]?\s*(?:-|–|to|through)\s*(\d{1,2})/i.exec(text ?? '');
  if (!m) {
    const single = /\b(\d{1,2})\s*[ab]?\b/.exec(text ?? '');
    if (!single) return null;
    const z = Number(single[1]);
    return z >= 1 && z <= 13 ? { min: z, max: z } : null;
  }
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (min < 1 || max > 13 || min > max) return null;
  return { min, max };
}

/**
 * Sizes in feet from text like "3-4 ft tall x 2-3 ft wide", "Height: 36 in.",
 * "15' H x 10' W". Ranges use their upper bound; inches convert to feet.
 */
export function parseSizesFt(text: string | null | undefined): { height: number | null; width: number | null } {
  const t = text ?? '';
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(ft\.?|feet|foot|'|in\.?|inches|inch|")(?:\s*(tall|high|h\b|height|wide|w\b|width|spread))?/gi;
  const found: { value: number; kind: 'h' | 'w' | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const n = Number(m[2] ?? m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = m[3].toLowerCase();
    const feet = unit.startsWith('in') || unit === '"' ? n / 12 : n;
    const tag = (m[4] ?? '').toLowerCase();
    const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    const kind = /tall|high|^h$|height/.test(tag) || /height/.test(before) ? 'h' : /wide|^w$|width|spread/.test(tag) || /width|spread/.test(before) ? 'w' : null;
    found.push({ value: Math.round(feet * 100) / 100, kind });
  }
  const height = found.find((f) => f.kind === 'h')?.value ?? found.find((f) => f.kind === null)?.value ?? null;
  const width = found.find((f) => f.kind === 'w')?.value ?? found.filter((f) => f.kind === null)[1]?.value ?? null;
  return { height, width };
}

/** "Evergreen shrub" / "Foliage: Evergreen" → true; "Evergreen: No", "semi-evergreen", "deciduous" → false. */
function isEvergreen(text: string): boolean {
  if (/\b(deciduous|semi-evergreen|non-evergreen)\b/i.test(text)) return false;
  if (/\bevergreen\s*[:?]?\s*(no|false)\b/i.test(text)) return false;
  return /\bevergreen\b/i.test(text);
}

function plantInfoFor(product: ProductResult): PlantInfo {
  const p = product.plant;
  const text = [product.name, product.description, ...product.specs].join(' ');
  const type = guessPlantType(`${product.name} ${p?.botanical ?? ''} ${product.description}`);
  const zones = parseZones(p?.zones ?? (/zones?\s*[\d]/i.test(text) ? text.slice(text.search(/zones?\s*\d/i)) : null));
  const size = parseSizesFt(p?.matureSize ?? null);
  const fallbackHeight = type === 'tree' ? 20 : type === 'shrub' || type === 'hedge' ? 4 : type === 'groundcover' ? 0.5 : 2;
  const height = size.height ?? fallbackHeight;
  const container = /(\d+(?:\.\d+)?)\s*(gal(?:lon)?s?|qt|quart)\b/i.exec(text);
  const info: PlantInfo = {
    type,
    sun: parseSun(p?.sun ?? text),
    water: parseWater(p?.water ?? null),
    matureHeightFt: height,
    matureWidthFt: size.width ?? height,
    evergreen: isEvergreen(text),
    indoor: type === 'houseplant' || /\b(indoor|houseplant)\b/i.test(text),
  };
  if (p?.botanical) info.botanical = p.botanical;
  if (zones) {
    info.zoneMin = zones.min;
    info.zoneMax = zones.max;
  }
  if (container) info.containerSize = `${container[1]} ${/q/i.test(container[2]) ? 'qt' : 'gal'}`;
  if (/deer[- ]resistant/i.test(text)) info.deerResistant = true;
  return info;
}

function lightBeamFor(text: string): LightBeam {
  if (/\bstring|bistro|festoon/i.test(text)) return 'string';
  if (/\bstrip|tape light|under[- ]cabinet|cove/i.test(text)) return 'strip';
  if (/\b(uplight|well light|in-ground)/i.test(text)) return 'up';
  if (/\b(spot ?light|flood ?light|accent light)/i.test(text)) return 'spot';
  if (/\b(path|pathway|sconce|lantern|wall light|pendant|chandelier|flush mount|ceiling|recessed|downlight|porch light)/i.test(text)) return 'down';
  return 'omni';
}

const LIGHT_HEIGHT_FT: [RegExp, number][] = [
  [/\bpost (light|lantern)|lamp post/i, 6],
  [/\b(path|pathway) light/i, 1.8],
  [/\bbollard/i, 3],
  [/\b(sconce|lantern|wall light|porch light)/i, 1.3],
  [/\b(pendant|chandelier)/i, 1.8],
  [/\b(spot ?light|flood ?light|uplight|well light)/i, 0.6],
  [/\b(string|bistro)/i, 0.4],
  [/\b(table lamp)/i, 2],
  [/\b(floor lamp)/i, 5.5],
];

function lightInfoFor(product: ProductResult): LightInfo {
  const text = [product.name, product.description, ...product.specs].join(' ');
  const beam = lightBeamFor(text);
  const lumens = product.light?.lumens && product.light.lumens > 0 ? product.light.lumens : 400;
  const outdoor = product.light?.outdoor ?? /\b(outdoor|exterior|landscape|path|garden|porch)/i.test(text);
  const indoor = product.light?.indoor ?? !outdoor;
  const info: LightInfo = {
    beam,
    kelvin: product.light?.kelvin && product.light.kelvin >= 1500 && product.light.kelvin <= 10000 ? product.light.kelvin : 2700,
    lumens,
    // Roughly how far a fixture of this output visibly lights its surroundings.
    reachFt: Math.round(Math.min(25, Math.max(3, Math.sqrt(lumens) / 2.5))),
    emitterY: beam === 'up' ? 0.1 : beam === 'down' ? (/\bpath/i.test(text) ? 0.15 : 0.4) : beam === 'string' || beam === 'strip' ? 0.5 : 0.35,
    indoor,
    outdoor,
  };
  if (/\bpath/i.test(text)) info.mountHeightFt = 0;
  else if (/\b(sconce|lantern|wall light|porch light)/i.test(text)) info.mountHeightFt = 6;
  else if (/\b(pendant|chandelier)/i.test(text)) info.mountHeightFt = 7;
  return info;
}

function defaultHeight(product: ProductResult, plant: PlantInfo | undefined): number {
  if (product.realHeightFt != null && product.realHeightFt > 0) return product.realHeightFt;
  if (plant) return Math.max(0.5, Math.min(plant.matureHeightFt, 6));
  if (product.category === 'lighting') {
    const text = `${product.name} ${product.description}`;
    for (const [re, ft] of LIGHT_HEIGHT_FT) if (re.test(text)) return ft;
  }
  return DEFAULT_HEIGHT_FT[product.category];
}

/**
 * Builds a library asset (source 'user') from a product. The caller stores the
 * cut-out image blob under `imageId` (store.addLibraryAsset(asset, blob)).
 * Category, realHeightFt (default by category when unknown), plant/light info
 * and ProductInfo are mapped from the product.
 */
export function productToAsset(product: ProductResult, image: { imageId: string; aspect: number }): AssetDef {
  const info: ProductInfo = {
    store: product.store,
    storeKind: product.storeKind,
    url: product.url,
    specs: product.specs,
    retrievedAt: Date.now(),
  };
  if (product.brand) info.brand = product.brand;
  if (product.priceUsd != null) info.priceUsd = product.priceUsd;
  if (product.priceText) info.priceText = product.priceText;
  if (product.imageUrl) info.imageUrl = product.imageUrl;

  const plant = product.category === 'plant' ? plantInfoFor(product) : undefined;
  const light = product.category === 'lighting' ? lightInfoFor(product) : undefined;
  const tags = [
    product.category,
    product.store,
    product.brand ?? '',
    plant?.type ?? '',
    light ? (light.outdoor ? 'outdoor' : 'indoor') : '',
  ]
    .map((t) => t.trim().toLowerCase())
    .filter((t, i, all) => t && all.indexOf(t) === i);

  const asset: AssetDef = {
    id: newId('asset'),
    name: product.name.trim() || 'Store product',
    category: product.category,
    source: 'user',
    imageId: image.imageId,
    aspect: Number.isFinite(image.aspect) && image.aspect > 0 ? image.aspect : 1,
    realHeightFt: Math.round(defaultHeight(product, plant) * 100) / 100,
    tags,
    vendorUrl: product.url,
    product: info,
    createdAt: Date.now(),
  };
  const description = product.description.trim() || product.specs.slice(0, 3).join(' · ');
  if (description) asset.description = description;
  if (plant) {
    asset.plant = plant;
    asset.subcategory = plant.type;
  }
  if (light) asset.light = light;
  if (product.priceUsd != null) asset.cost = { low: product.priceUsd, high: product.priceUsd, unit: 'each' };
  return asset;
}
