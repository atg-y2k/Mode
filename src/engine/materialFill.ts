/**
 * Applies a material texture to a masked region, keeping the photo's shading.
 *
 * Mapping:
 * - 'screen': texture laid flat in image space at `pxPerInch` (photo px per
 *   real inch), rotated by `rotationDeg` — good for walls seen head-on.
 * - 'plane': the region has a perspective quad (Region.plane). A homography
 *   maps each pixel to (u, v) inches on the real surface, so floors, patios and
 *   lawns recede correctly.
 *
 * Sampling uses a mip chain of the tile (linear light, wrap-around box
 * filtered) with trilinear filtering, plus up to 4 anisotropic taps along the
 * receding direction of a plane, so distant texture averages out instead of
 * shimmering into moiré.
 */
import type { MaterialDef, MaterialTreatment, Photo, Pt, Quad, Region, SurfaceKind } from '../../shared/types';
import { SRGB8_TO_LINEAR, linearToSrgb8 } from './color';
import { applyHomography, computeHomography, distance, invertMat3, isConvexQuad, pointInPolygon, type Mat3 } from './geometry';
import type { RegionStats } from './recolor';
import { accumAniso, accumTrilinear, buildMipChain, mapChain, type MipChain } from './tex/mip';
import { hexToLinear } from './tex/surface';
import type { TextureTile } from './textures';
import type { ImageDataLike, Mask } from './types';

export type TextureMapping =
  | { kind: 'screen'; pxPerInch: number; rotationDeg: number; offsetX?: number; offsetY?: number }
  | { kind: 'plane'; quad: Quad; widthIn: number; heightIn: number; rotationDeg: number };

export interface MaterialOptions {
  tile: TextureTile;
  mapping: TextureMapping;
  /** Multiplied into the texture color. */
  tint?: string;
  /** 0..1 */
  strength: number;
  /** 0..1 — how much of the photo's light/shadow variation to keep (default 0.85). */
  shading?: number;
}

// ---------------------------------------------------------------------------
// Mip chains (cached per tile and tint)
// ---------------------------------------------------------------------------

const chains = new WeakMap<TextureTile, { base: MipChain; tinted: Map<string, MipChain> }>();

/** Share of the texture's own color variation kept under a tint. */
const TINT_KEEP = 0.2;

/**
 * The tile's mip chain, tinted when `tint` is a valid hex. A tint recolors
 * the material: the texture's mean becomes the tint color while its light /
 * dark structure (and a little of its own color variation) is kept.
 */
function chainFor(tile: TextureTile, tint: string | undefined): MipChain {
  let entry = chains.get(tile);
  if (!entry) {
    entry = { base: buildMipChain(tile), tinted: new Map() };
    chains.set(tile, entry);
  }
  const t = tint ? hexToLinear(tint) : null;
  if (!t) return entry.base;
  const key = tint!.toLowerCase();
  let c = entry.tinted.get(key);
  if (!c) {
    const m = entry.base.mean;
    const ym = Math.max(1e-4, 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]);
    const yt = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
    const a0 = (t[0] / ym) * (1 - TINT_KEEP);
    const a1 = (t[1] / ym) * (1 - TINT_KEEP);
    const a2 = (t[2] / ym) * (1 - TINT_KEEP);
    const keep = (yt / ym) * TINT_KEEP;
    c = mapChain(entry.base, (r, g, b, out, o) => {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      out[o] = a0 * y + keep * r;
      out[o + 1] = a1 * y + keep * g;
      out[o + 2] = a2 * y + keep * b;
    });
    if (entry.tinted.size > 8) entry.tinted.delete(entry.tinted.keys().next().value!);
    entry.tinted.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

const Y2L_SIZE = 4096;
/** Relative luminance Y (0..1) → CIE L*, sampled for interpolation. */
const Y_TO_L: Float32Array = (() => {
  const t = new Float32Array(Y2L_SIZE + 2);
  for (let i = 0; i <= Y2L_SIZE + 1; i++) {
    const y = Math.min(1, i / Y2L_SIZE);
    t[i] = y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  }
  return t;
})();

function yToL(y: number): number {
  if (!(y > 0)) return 0;
  if (y >= 1) return 100;
  const x = y * Y2L_SIZE;
  const i = x | 0;
  return Y_TO_L[i] + (Y_TO_L[i + 1] - Y_TO_L[i]) * (x - i);
}

/** Box blur with zero padding (normalized convolution uses it on value·mask and mask). */
function boxBlurZero(a: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  if (r <= 0) return;
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = 0; k < r && k < w; k++) s += a[row + k];
    for (let x = 0; x < w; x++) {
      const add = x + r;
      if (add < w) s += a[row + add];
      tmp[row + x] = s * inv;
      const sub = x - r;
      if (sub >= 0) s -= a[row + sub];
    }
  }
  const col = new Float64Array(w);
  for (let k = 0; k < r && k < h; k++) {
    const row = k * w;
    for (let x = 0; x < w; x++) col[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = y + r;
    const sub = y - r;
    const ra = add * w;
    const rs = sub * w;
    const row = y * w;
    if (add < h) for (let x = 0; x < w; x++) col[x] += tmp[ra + x];
    for (let x = 0; x < w; x++) a[row + x] = col[x] * inv;
    if (sub >= 0) for (let x = 0; x < w; x++) col[x] -= tmp[rs + x];
  }
}

/** Bounding box of mask > 0 inside the first w×h pixels. */
function maskBox(mask: Mask, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const md = mask.data;
  const mw = mask.width;
  let x0 = w;
  let x1 = -1;
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * mw;
    let first = -1;
    for (let x = 0; x < w; x++) {
      if (md[row + x] !== 0) {
        first = x;
        break;
      }
    }
    if (first < 0) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (first < x0) x0 = first;
    for (let x = w - 1; x > x1; x--) {
      if (md[row + x] !== 0) {
        x1 = x;
        break;
      }
    }
  }
  return y0 < 0 ? null : { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
// applyMaterial
// ---------------------------------------------------------------------------

/** Rolls linear values above the knee off smoothly toward 1 instead of clipping flat. */
function softClip(v: number): number {
  if (v <= 0.82) return v;
  return 0.82 + 0.18 * (1 - Math.exp(-(v - 0.82) / 0.18));
}

/**
 * Writes the textured surface into `dst` where mask > 0, sampling the tile with
 * bilinear filtering and wrap-around, modulated by the shading of `src`
 * (the ORIGINAL photo) relative to the region's mean lightness.
 *
 * Shading: the photo's lightness inside the mask is low-passed with a masked
 * (normalized) blur of a few pixels — that keeps light falloff and shadows but
 * drops the old surface's own texture (grout lines, wood grain) — and each
 * pixel's deviation from the region's mean L*, scaled by `shading`, is applied
 * to the texture as the equivalent change in reflected light.
 * Pixels with mask = 0 are never touched; strength ≤ 0 is a no-op.
 */
export function applyMaterial(
  src: ImageDataLike,
  dst: ImageDataLike,
  mask: Mask,
  opts: MaterialOptions,
  stats?: RegionStats,
): void {
  const strength = Number.isFinite(opts.strength) ? Math.min(1, Math.max(0, opts.strength)) : 0;
  if (!(strength > 0)) return;
  const tile = opts.tile;
  if (!tile || !(tile.width > 0) || !(tile.height > 0) || !(tile.pxPerInch > 0)) return;
  const W = Math.min(src.width, dst.width, mask.width);
  const H = Math.min(src.height, dst.height, mask.height);
  const box = maskBox(mask, W, H);
  if (!box) return;
  const shadingAmt = Math.min(1, Math.max(0, opts.shading ?? 0.85));

  // --- shading: masked low-pass of L* over the (padded) mask bounds -------
  const radius = Math.max(1, Math.min(6, Math.round(Math.max(W, H) / 400)));
  const bx0 = Math.max(0, box.x0 - radius);
  const by0 = Math.max(0, box.y0 - radius);
  const bx1 = Math.min(W - 1, box.x1 + radius);
  const by1 = Math.min(H - 1, box.y1 + radius);
  const bw = bx1 - bx0 + 1;
  const bh = by1 - by0 + 1;
  const lm = new Float32Array(bw * bh);
  const mm = new Float32Array(bw * bh);
  const sd = src.data;
  const md = mask.data;
  const lin = SRGB8_TO_LINEAR;
  let sumL = 0;
  let sumM = 0;
  for (let y = by0; y <= by1; y++) {
    const srow = y * src.width;
    const mrow = y * mask.width;
    const brow = (y - by0) * bw - bx0;
    for (let x = bx0; x <= bx1; x++) {
      const m = md[mrow + x];
      if (m === 0) continue;
      const p = (srow + x) * 4;
      const L = yToL(0.2126 * lin[sd[p]] + 0.7152 * lin[sd[p + 1]] + 0.0722 * lin[sd[p + 2]]);
      const mw = m / 255;
      lm[brow + x] = L * mw;
      mm[brow + x] = mw;
      sumL += L * mw;
      sumM += mw;
    }
  }
  if (!(sumM > 0)) return;
  const meanL = stats && stats.count > 0 && Number.isFinite(stats.meanL) ? stats.meanL : sumL / sumM;
  if (shadingAmt > 0) {
    const tmp = new Float32Array(bw * bh);
    for (let pass = 0; pass < 2; pass++) {
      boxBlurZero(lm, bw, bh, radius, tmp);
      boxBlurZero(mm, bw, bh, radius, tmp);
    }
  }
  const denom = meanL + 16;

  // --- mapping ------------------------------------------------------------
  const chain = chainFor(tile, opts.tint);
  const acc = new Float64Array(3);
  const dd = dst.data;
  const dw = dst.width;
  const map = opts.mapping;
  const mean = chain.mean;

  // Screen: affine (U, V) = A·(x, y) + c in level-0 texels; plane: projective G.
  let G: Mat3 | null = null;
  let wSign = 1;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  let f = 0;
  let screenLod = 0;
  if (map.kind === 'plane') {
    G = planeMatrix(map, tile.pxPerInch);
    if (G) {
      const cx = (map.quad[0].x + map.quad[1].x + map.quad[2].x + map.quad[3].x) / 4;
      const cy = (map.quad[0].y + map.quad[1].y + map.quad[2].y + map.quad[3].y) / 4;
      wSign = G[6] * cx + G[7] * cy + G[8] >= 0 ? 1 : -1;
    }
  }
  if (!G) {
    const ppi = map.kind === 'screen' && map.pxPerInch > 0 && Number.isFinite(map.pxPerInch) ? map.pxPerInch : 2;
    const rot = (((map.rotationDeg ?? 0) || 0) * Math.PI) / 180;
    const k = tile.pxPerInch / ppi;
    const cos = Math.cos(rot) * k;
    const sin = Math.sin(rot) * k;
    const ox = map.kind === 'screen' ? map.offsetX ?? 0 : 0;
    const oy = map.kind === 'screen' ? map.offsetY ?? 0 : 0;
    // Pattern rotated clockwise by rot on screen: texel = R(−rot)·(p − o)·k.
    a = cos;
    b = sin;
    c = -(cos * ox + sin * oy);
    d = -sin;
    e = cos;
    f = sin * ox - cos * oy;
    screenLod = k > 1 ? Math.log2(k) : 0;
  }

  for (let y = box.y0; y <= box.y1; y++) {
    const mrow = y * mask.width;
    const brow = (y - by0) * bw - bx0;
    const py = y + 0.5;
    for (let x = box.x0; x <= box.x1; x++) {
      const m = md[mrow + x];
      if (m === 0) continue;
      const px = x + 0.5;
      acc[0] = acc[1] = acc[2] = 0;
      if (G) {
        const wz = G[6] * px + G[7] * py + G[8];
        if (wz * wSign <= 1e-9) {
          // Beyond the plane's horizon: only the average color is meaningful.
          acc[0] = mean[0];
          acc[1] = mean[1];
          acc[2] = mean[2];
        } else {
          const iw = 1 / wz;
          const U = (G[0] * px + G[1] * py + G[2]) * iw;
          const V = (G[3] * px + G[4] * py + G[5]) * iw;
          accumAniso(
            chain,
            U,
            V,
            (G[0] - U * G[6]) * iw,
            (G[3] - V * G[6]) * iw,
            (G[1] - U * G[7]) * iw,
            (G[4] - V * G[7]) * iw,
            4,
            acc,
          );
        }
      } else {
        accumTrilinear(chain, a * px + b * py + c, d * px + e * py + f, screenLod, 1, acc);
      }
      // Shading factor: the photo's (low-passed) lightness deviation as a reflectance ratio.
      let k = 1;
      if (shadingAmt > 0) {
        const bi = brow + x;
        const mw = mm[bi];
        const Lb = mw > 1e-6 ? lm[bi] / mw : meanL;
        const r = (meanL + shadingAmt * (Lb - meanL) + 16) / denom;
        k = r > 0 ? r * r * r : 0;
        if (k > 4) k = 4;
      }
      const alpha = (m / 255) * strength;
      const q = (y * dw + x) * 4;
      const R = linearToSrgb8(softClip(acc[0] * k));
      const Gc = linearToSrgb8(softClip(acc[1] * k));
      const B = linearToSrgb8(softClip(acc[2] * k));
      dd[q] = dd[q] + (R - dd[q]) * alpha;
      dd[q + 1] = dd[q + 1] + (Gc - dd[q + 1]) * alpha;
      dd[q + 2] = dd[q + 2] + (B - dd[q + 2]) * alpha;
    }
  }
}

/**
 * Projective matrix taking photo pixel coordinates to level-0 tile texels for
 * a plane mapping (null if the quad is degenerate).
 */
function planeMatrix(map: Extract<TextureMapping, { kind: 'plane' }>, tilePpi: number): Mat3 | null {
  if (!isConvexQuad(map.quad) || !(map.widthIn > 0) || !(map.heightIn > 0)) return null;
  let H: Mat3;
  try {
    H = computeHomography(UNIT_SQUARE, map.quad);
  } catch {
    return null;
  }
  const Hinv = invertMat3(H);
  if (!Hinv) return null;
  const rot = (((map.rotationDeg ?? 0) || 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  // texel = ppi · R(−rot) · diag(widthIn, heightIn) · Hinv · pixel
  const s0 = tilePpi * map.widthIn;
  const s1 = tilePpi * map.heightIn;
  const r00 = cos * s0;
  const r01 = sin * s1;
  const r10 = -sin * s0;
  const r11 = cos * s1;
  return [
    r00 * Hinv[0] + r01 * Hinv[3],
    r00 * Hinv[1] + r01 * Hinv[4],
    r00 * Hinv[2] + r01 * Hinv[5],
    r10 * Hinv[0] + r11 * Hinv[3],
    r10 * Hinv[1] + r11 * Hinv[4],
    r10 * Hinv[2] + r11 * Hinv[5],
    Hinv[6],
    Hinv[7],
    Hinv[8],
  ];
}

const UNIT_SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// ---------------------------------------------------------------------------
// mappingForRegion
// ---------------------------------------------------------------------------

const EXTERIOR_SURFACES: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>([
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
]);

/**
 * Real width (feet) the full photo width is assumed to show when nothing is
 * calibrated: about 13 ft for rooms (the 12–15 ft heuristic), about 40 ft for
 * exterior surfaces (a facade or yard seen from the street).
 */
export function assumedPhotoSpanFt(surface: SurfaceKind): number {
  return EXTERIOR_SURFACES.has(surface) ? 40 : 13;
}

/** Assumed focal length (px) for photos without metadata: ~26 mm-equivalent phone lens. */
function defaultFocal(width: number, height: number): number {
  return 0.75 * Math.max(width, height);
}

/**
 * Real-world aspect (width / height) of the rectangle a perspective quad
 * depicts. The focal length comes from the orthogonality of the rectangle's
 * sides when both vanishing points are finite, else a typical phone lens is
 * assumed; the principal point is the image centre.
 */
export function estimatePlaneAspect(quad: Quad, photoW: number, photoH: number): number {
  let H: Mat3;
  try {
    H = computeHomography(UNIT_SQUARE, quad);
  } catch {
    return 1;
  }
  const cx = photoW / 2;
  const cy = photoH / 2;
  const a1 = H[0] - cx * H[6];
  const b1 = H[3] - cy * H[6];
  const c1 = H[6];
  const a2 = H[1] - cx * H[7];
  const b2 = H[4] - cy * H[7];
  const c2 = H[7];
  const fDef = defaultFocal(photoW, photoH);
  let f2 = fDef * fDef;
  if (Math.abs(c1 * c2) > 1e-12) {
    const est = -(a1 * a2 + b1 * b2) / (c1 * c2);
    const lim = Math.max(photoW, photoH);
    if (est > (0.35 * lim) ** 2 && est < (3 * lim) ** 2) f2 = est;
  }
  const n1 = Math.sqrt((a1 * a1 + b1 * b1) / f2 + c1 * c1);
  const n2 = Math.sqrt((a2 * a2 + b2 * b2) / f2 + c2 * c2);
  const r = n2 > 0 ? n1 / n2 : 1;
  return Number.isFinite(r) ? Math.min(12, Math.max(1 / 12, r)) : 1;
}

/**
 * Chooses the mapping for a region:
 * - region.plane present -> 'plane' using its real size if known, else an
 *   estimate (calibration, else assume the quad spans ~12 ft wide);
 * - else 'screen' using calibration px/ft when available, else a heuristic
 *   (a typical surface ~ 12-15 ft across the photo width).
 * The treatment's scale multiplies the material's real unit size; rotation is added.
 *
 * Details: for planes without a real size the missing side follows from the
 * quad's estimated real aspect (estimatePlaneAspect). With a calibration
 * line lying on the plane, the plane is measured through the homography;
 * otherwise the calibration's px/ft is applied to the quad's mean edge
 * width. Without calibration the quad's width is taken as its share of the
 * photo width times the assumed photo span (assumedPhotoSpanFt: ~13 ft
 * indoors, so a quad across a room is ~12 ft; ~40 ft outdoors). The
 * returned tilePxPerInch is the finest texture density the region shows
 * (photo px per texture inch near the camera), for getTexture.
 */
export function mappingForRegion(
  region: Region,
  photo: Pick<Photo, 'width' | 'height' | 'calibration'>,
  treatment: MaterialTreatment,
  material: MaterialDef,
): { mapping: TextureMapping; tilePxPerInch: number } {
  void material;
  const scale = Number.isFinite(treatment.scale) && treatment.scale > 0 ? treatment.scale : 1;
  const rotationDeg = Number.isFinite(treatment.rotation) ? treatment.rotation : 0;
  const pxPerFtCal = calibrationPxPerFt(photo.calibration);
  const plane = region.plane;
  if (plane && isConvexQuad(plane.quad)) {
    const size = planeSizeFt(region.surface, plane, photo, pxPerFtCal);
    if (size) {
      const widthIn = (size.widthFt * 12) / scale;
      const heightIn = (size.heightFt * 12) / scale;
      const mapping: TextureMapping = { kind: 'plane', quad: plane.quad, widthIn, heightIn, rotationDeg };
      return { mapping, tilePxPerInch: clampPpi(maxPlaneDensity(plane.quad, widthIn, heightIn)) };
    }
  }
  const basePpi = pxPerFtCal
    ? pxPerFtCal / 12
    : Math.max(1, photo.width) / (assumedPhotoSpanFt(region.surface) * 12);
  const pxPerInch = basePpi * scale;
  return { mapping: { kind: 'screen', pxPerInch, rotationDeg }, tilePxPerInch: clampPpi(pxPerInch) };
}

function clampPpi(v: number): number {
  return Number.isFinite(v) ? Math.min(48, Math.max(0.25, v)) : 4;
}

function calibrationPxPerFt(cal: Photo['calibration']): number | null {
  if (!cal || !(cal.lengthFt > 0) || !Number.isFinite(cal.lengthFt)) return null;
  const d = distance(cal.a, cal.b);
  return d > 1 && Number.isFinite(d) ? d / cal.lengthFt : null;
}

function planeSizeFt(
  surface: SurfaceKind,
  plane: NonNullable<Region['plane']>,
  photo: Pick<Photo, 'width' | 'height' | 'calibration'>,
  pxPerFtCal: number | null,
): { widthFt: number; heightFt: number } | null {
  const okW = plane.widthFt !== undefined && plane.widthFt > 0 && Number.isFinite(plane.widthFt);
  const okH = plane.heightFt !== undefined && plane.heightFt > 0 && Number.isFinite(plane.heightFt);
  if (okW && okH) return { widthFt: plane.widthFt!, heightFt: plane.heightFt! };
  const q = plane.quad;
  const aspect = estimatePlaneAspect(q, photo.width, photo.height);
  if (okW) return { widthFt: plane.widthFt!, heightFt: plane.widthFt! / aspect };
  if (okH) return { widthFt: plane.heightFt! * aspect, heightFt: plane.heightFt! };
  let widthFt: number | null = null;
  const cal = photo.calibration;
  if (cal && pxPerFtCal) {
    if (onPlane(cal.a, q) && onPlane(cal.b, q)) {
      // Measure the calibration line through the plane: lengthFt = k·|(Δs·aspect, Δt)|.
      try {
        const Hinv = invertMat3(computeHomography(UNIT_SQUARE, q));
        if (Hinv) {
          const a = applyHomography(Hinv, cal.a);
          const b = applyHomography(Hinv, cal.b);
          const span = Math.hypot((b.x - a.x) * aspect, b.y - a.y);
          if (span > 1e-6) widthFt = (cal.lengthFt / span) * aspect;
        }
      } catch {
        widthFt = null;
      }
    }
    if (widthFt === null) widthFt = meanWidthPx(q) / pxPerFtCal;
  }
  if (widthFt === null) widthFt = (meanWidthPx(q) / Math.max(1, photo.width)) * assumedPhotoSpanFt(surface);
  if (!Number.isFinite(widthFt) || !(widthFt > 0)) return null;
  widthFt = Math.min(400, Math.max(1, widthFt));
  return { widthFt, heightFt: widthFt / aspect };
}

/** Mean of the quad's top and bottom edge lengths, px. */
function meanWidthPx(q: Quad): number {
  return (distance(q[0], q[1]) + distance(q[3], q[2])) / 2;
}

/** Inside the quad or within 5% of its size from it. */
function onPlane(p: Pt, q: Quad): boolean {
  if (pointInPolygon(p, q)) return true;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const grown = q.map((v) => ({ x: cx + (v.x - cx) * 1.1, y: cy + (v.y - cy) * 1.1 }));
  return pointInPolygon(p, grown);
}

/** Largest photo-px-per-texture-inch over the quad's corners (the near side sets the tile resolution). */
function maxPlaneDensity(q: Quad, widthIn: number, heightIn: number): number {
  let H: Mat3;
  try {
    H = computeHomography(UNIT_SQUARE, q);
  } catch {
    return 4;
  }
  let best = 0;
  for (const [s, t] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const w = H[6] * s + H[7] * t + H[8];
    if (!(Math.abs(w) > 1e-12)) continue;
    const x = (H[0] * s + H[1] * t + H[2]) / w;
    const y = (H[3] * s + H[4] * t + H[5]) / w;
    // ∂(x, y)/∂s and ∂(x, y)/∂t, per texture inch.
    const dxs = (H[0] - x * H[6]) / w / widthIn;
    const dys = (H[3] - y * H[6]) / w / widthIn;
    const dxt = (H[1] - x * H[7]) / w / heightIn;
    const dyt = (H[4] - y * H[7]) / w / heightIn;
    best = Math.max(best, Math.hypot(dxs, dys), Math.hypot(dxt, dyt));
  }
  return best > 0 ? best : 4;
}
