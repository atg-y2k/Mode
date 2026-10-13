/**
 * Procedural, seamlessly tiling material textures (wood, tile, brick, pavers,
 * gravel, mulch, grass, siding, roofing…). Deterministic for a given spec+seed.
 * Pure pixel generation — no canvas — so it also runs in tests and workers.
 *
 * Each pattern (src/engine/tex/*) plans a tile span holding whole repeat
 * periods, paints a linear-light albedo plus a relief map in inches, and the
 * shared finish pass lights the relief (soft top-left light + cavity
 * occlusion). Noise is periodic over the tile and element layouts wrap, so
 * the tile repeats without seams.
 */
import type { TextureSpec } from '../../shared/types';
import { accumTrilinear, buildMipChain } from './tex/mip';
import { PATTERNS } from './tex/registry';
import { normalizeSpec } from './tex/spec';
import { createSurface, downsampleRgba, finishSurface } from './tex/surface';
import { linearToSrgb8 } from './color';
import type { ImageDataLike } from './types';

/** One full repeat period of a texture. Tiling it edge-to-edge must show no seams. */
export interface TextureTile extends ImageDataLike {
  /** Pixels per real-world inch the tile was generated at. */
  pxPerInch: number;
}

/** Hard cap for a tile side; generators reduce pxPerInch to fit. */
export const MAX_TILE_SIZE = 1024;

/** Resolution bounds for requests (px per inch). */
const MIN_PPI = 0.02;
const MAX_PPI = 96;
/** Largest side of the supersampled working buffer. */
const MAX_WORK_SIZE = 1536;

/**
 * Generates the tile. The repeat period depends on the pattern (e.g. a running
 * bond brick period is 2 rows; herringbone has its own period); the tile must
 * contain whole periods so it repeats seamlessly. Noise-based patterns (gravel,
 * mulch, grass, concrete, stucco, terrazzo, marble) use periodic noise.
 *
 * The returned tile's pxPerInch equals the request unless the tile would
 * exceed MAX_TILE_SIZE, in which case it is reduced to fit. When the request
 * is too coarse to resolve the pattern's finest features, the tile is
 * rendered supersampled and box-filtered down (so it averages, not aliases).
 */
export function generateTexture(spec: TextureSpec, pxPerInch: number): TextureTile {
  const ns = normalizeSpec(spec);
  const plan = PATTERNS[ns.pattern](ns);
  let ppi = Number.isFinite(pxPerInch) && pxPerInch > 0 ? pxPerInch : 8;
  ppi = Math.min(Math.max(ppi, MIN_PPI), MAX_PPI, MAX_TILE_SIZE / plan.spanX, MAX_TILE_SIZE / plan.spanY);
  const w = Math.max(1, Math.min(MAX_TILE_SIZE, Math.round(plan.spanX * ppi)));
  const h = Math.max(1, Math.min(MAX_TILE_SIZE, Math.round(plan.spanY * ppi)));
  let k = 1;
  while (
    ppi * k * plan.minFeatureIn < 2 &&
    w * (k + 1) <= MAX_WORK_SIZE &&
    h * (k + 1) <= MAX_WORK_SIZE &&
    k < 8
  ) {
    k++;
  }
  const s = createSurface(w * k, h * k, (w * k) / plan.spanX, (h * k) / plan.spanY);
  const finish = plan.render(s);
  let data = finishSurface(s, finish);
  if (k > 1) data = downsampleRgba(data, w * k, h * k, k);
  return { width: w, height: h, data, pxPerInch: ppi };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  ppi: number;
  tile: TextureTile;
}

/** Entries are reused for requests within this relative resolution difference. */
const PPI_TOLERANCE = 0.03;
const CACHE_MAX_ENTRIES = 24;
const CACHE_MAX_BYTES = 96 * 1024 * 1024;
const cache: CacheEntry[] = [];

function specKey(spec: TextureSpec): string {
  return JSON.stringify([
    spec.pattern,
    spec.colors,
    spec.unitWidthIn,
    spec.unitHeightIn,
    spec.joint ? [spec.joint.color, spec.joint.widthIn] : null,
    spec.variation,
    spec.seed,
  ]);
}

/**
 * Memoized generateTexture (small LRU keyed by spec + pxPerInch). A cached
 * tile is reused for requests within ±3% of its resolution, so slowly
 * changing requests (dragging a plane corner) don't regenerate every frame;
 * callers map with the returned tile's own pxPerInch, so scale stays exact.
 */
export function getTexture(spec: TextureSpec, pxPerInch: number): TextureTile {
  const key = specKey(spec);
  for (let i = cache.length - 1; i >= 0; i--) {
    const e = cache[i];
    if (e.key === key && Math.abs(e.ppi - pxPerInch) <= PPI_TOLERANCE * Math.max(e.ppi, pxPerInch)) {
      cache.splice(i, 1);
      cache.push(e);
      return e.tile;
    }
  }
  const tile = generateTexture(spec, pxPerInch);
  cache.push({ key, ppi: pxPerInch, tile });
  let bytes = 0;
  for (const e of cache) bytes += e.tile.data.length;
  while (cache.length > CACHE_MAX_ENTRIES || (bytes > CACHE_MAX_BYTES && cache.length > 1)) {
    const old = cache.shift()!;
    bytes -= old.tile.data.length;
  }
  return tile;
}

/** Drops every cached tile (tests, memory pressure). */
export function clearTextureCache(): void {
  cache.length = 0;
}

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

/**
 * Default span of a swatch: about three repeating units, but at least a foot
 * (so gravel, grass or carpet read as a surface, not a macro shot) and at
 * most 8 ft.
 */
export function defaultSwatchSpan(spec: TextureSpec): number {
  const uw = Number.isFinite(spec.unitWidthIn) && spec.unitWidthIn > 0 ? spec.unitWidthIn : 12;
  const uh = Number.isFinite(spec.unitHeightIn) && spec.unitHeightIn > 0 ? spec.unitHeightIn : 12;
  return Math.min(96, Math.max(12, 3 * Math.max(uw, uh)));
}

/**
 * Square swatch for the UI (e.g. 96×96), showing roughly `spanIn` inches of
 * the material (default: about 3 repeat units, see defaultSwatchSpan). The
 * tile is generated at 2× and filtered down for clean edges.
 */
export function textureSwatch(spec: TextureSpec, sizePx: number, spanIn?: number): ImageDataLike {
  const size = Math.max(1, Math.round(Number.isFinite(sizePx) ? sizePx : 96));
  const span = spanIn !== undefined && Number.isFinite(spanIn) && spanIn > 0 ? spanIn : defaultSwatchSpan(spec);
  const ppi = size / span;
  const tile = getTexture(spec, ppi * 2);
  const chain = buildMipChain(tile);
  const texelsPerPx = tile.pxPerInch / ppi;
  const lod = texelsPerPx > 1 ? Math.log2(texelsPerPx) : 0;
  const data = new Uint8ClampedArray(size * size * 4);
  const acc = new Float64Array(3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      acc[0] = acc[1] = acc[2] = 0;
      accumTrilinear(chain, (x + 0.5) * texelsPerPx, (y + 0.5) * texelsPerPx, lod, 1, acc);
      const q = (y * size + x) * 4;
      data[q] = linearToSrgb8(acc[0]);
      data[q + 1] = linearToSrgb8(acc[1]);
      data[q + 2] = linearToSrgb8(acc[2]);
      data[q + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
