/** Real-world measurement helpers built on photo calibration and region planes. */
import type { AssetDef, Calibration, Photo, Region } from '../../shared/types';
import { computeHomography, invertMat3, type Mat3 } from '../engine/geometry';
import { maskBounds } from '../engine/mask';
import type { Mask } from '../engine/types';

/** Photo pixels per real foot from a calibration line, or null. */
export function pxPerFoot(cal: Calibration | undefined): number | null {
  if (!cal || !(cal.lengthFt > 0) || !Number.isFinite(cal.lengthFt)) return null;
  const d = Math.hypot(cal.b.x - cal.a.x, cal.b.y - cal.a.y);
  if (!Number.isFinite(d) || d < 1) return null;
  return d / cal.lengthFt;
}

export type AreaMethod = 'override' | 'plane' | 'calibration' | 'none';

type PhotoGeom = Pick<Photo, 'width' | 'height' | 'calibration'>;

const UNIT_SQUARE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Real area (sq ft) of the masked pixels on a perspective plane.
 *
 * M maps photo px → the plane's unit square, so one photo pixel covers
 * W·H·|det M| / |w|³ sq ft, where w = M[6]x + M[7]y + M[8] (Jacobian of a
 * projective map). Summing that per pixel weights far-away pixels correctly,
 * which a plain coverage ratio does not. Masked pixels inside the quad are
 * exact; pixels outside it are extrapolated along the same plane, but only on
 * the camera side of the horizon and with each pixel's area capped at 4× the
 * largest inside the quad (extrapolation far beyond the reference gets unreliable).
 * Returns null when the plane is unusable.
 */
function planeAreaSqFt(mask: Mask, photo: PhotoGeom, plane: NonNullable<Region['plane']>): number | null {
  const W = plane.widthFt;
  const H = plane.heightFt;
  if (!(W && W > 0 && H && H > 0)) return null;
  let M: Mat3;
  try {
    M = computeHomography(plane.quad, UNIT_SQUARE);
  } catch {
    return null;
  }
  // computeHomography already validated M; invertMat3 only checks it isn't singular.
  if (!invertMat3(M)) return null;
  const [a, b, c, d, e, f, g, h, i] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const k = W * H * Math.abs(det);
  if (!(k > 0) || !Number.isFinite(k)) return null;

  // Sign of w on the plane (quad corners) and the largest per-pixel area inside it.
  let wSign = 0;
  let maxInside = 0;
  for (const p of plane.quad) {
    const w = g * p.x + h * p.y + i;
    if (w === 0) return null;
    const s = Math.sign(w);
    if (wSign && s !== wSign) return null; // quad straddles the horizon: not a real plane
    wSign = s;
    maxInside = Math.max(maxInside, k / Math.abs(w * w * w));
  }
  const cap = maxInside * 4;

  const bounds = maskBounds(mask);
  if (!bounds) return 0;
  const { width: mw, data } = mask;
  // Mask pixels → photo px (masks normally match the photo size exactly).
  const sx = photo.width / mask.width;
  const sy = photo.height / mask.height;
  const pixelArea = sx * sy;
  let total = 0;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    const py = (y + 0.5) * sy;
    const rowW = h * py + i;
    let row = 0;
    const off = y * mw;
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const m = data[off + x];
      if (m === 0) continue;
      const px = (x + 0.5) * sx;
      const w = g * px + rowW;
      if (w * wSign <= 0) continue; // beyond the horizon: cannot be on this plane
      const aw = Math.abs(w);
      // 1/|w|³ peaks at a corner over the convex quad, so the cap never touches pixels inside it.
      const area = Math.min(cap, k / (aw * aw * aw));
      row += area * m;
    }
    total += row;
  }
  return (total / 255) * pixelArea;
}

/** Covered pixels of a mask, scaled to photo pixels when sizes differ. */
function coveragePhotoPx(mask: Mask, photo: PhotoGeom): number {
  const bounds = maskBounds(mask);
  if (!bounds) return 0;
  const { width: mw, data } = mask;
  let sum = 0;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    const off = y * mw;
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) sum += data[off + x];
  }
  return (sum / 255) * (photo.width / mask.width) * (photo.height / mask.height);
}

/**
 * Estimated area of a region in sq ft:
 * override → plane (mask coverage inside the quad × real quad area) →
 * calibration (coverage / pxPerFoot², a flat-on approximation) → none (null).
 * The plane estimate is perspective-correct (see planeAreaSqFt).
 */
export function regionAreaSqFt(region: Region, mask: Mask | undefined, photo: PhotoGeom): { sqft: number | null; method: AreaMethod } {
  const override = region.areaSqFtOverride;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return { sqft: override, method: 'override' };
  if (!mask || mask.width <= 0 || mask.height <= 0 || mask.data.length !== mask.width * mask.height) {
    return { sqft: null, method: 'none' };
  }
  if (region.plane) {
    const sqft = planeAreaSqFt(mask, photo, region.plane);
    if (sqft !== null && Number.isFinite(sqft)) return { sqft, method: 'plane' };
  }
  const ppf = pxPerFoot(photo.calibration);
  if (ppf) return { sqft: coveragePhotoPx(mask, photo) / (ppf * ppf), method: 'calibration' };
  return { sqft: null, method: 'none' };
}

/** Share of the photo height a newly placed asset gets when the photo is not calibrated. */
function defaultHeightFraction(asset: AssetDef): number {
  const plant = asset.plant;
  if (plant) {
    switch (plant.type) {
      case 'tree':
        return 0.45;
      case 'shrub':
      case 'hedge':
        return 0.18;
      case 'vine':
        return 0.25;
      case 'houseplant':
        return 0.2;
      case 'groundcover':
        return 0.06;
      default:
        return 0.1; // perennials, annuals, grasses, ferns, succulents
    }
  }
  const words = `${asset.subcategory ?? ''} ${asset.tags.join(' ')}`.toLowerCase();
  switch (asset.category) {
    case 'plant':
      if (/\btree\b/.test(words)) return 0.45;
      if (/\b(shrub|hedge|bush)\b/.test(words)) return 0.18;
      return 0.1;
    case 'lighting':
      return 0.08;
    case 'hardscape':
      return 0.12;
    case 'decor':
    case 'furniture':
    case 'other':
    default:
      return 0.15;
  }
}

/**
 * Default on-photo height (px) for a newly placed asset: realHeightFt × pxPerFoot
 * when calibrated, else a fraction of the photo height by category
 * (trees ~45%, shrubs ~18%, perennials ~10%, fixtures ~8%, decor ~15%).
 */
export function defaultObjectHeightPx(asset: AssetDef, photo: PhotoGeom): number {
  const minPx = Math.max(8, photo.height * 0.01);
  const maxPx = photo.height * 1.5;
  const ppf = pxPerFoot(photo.calibration);
  const real = asset.realHeightFt;
  const px = ppf && real > 0 && Number.isFinite(real) ? real * ppf : photo.height * defaultHeightFraction(asset);
  return Math.round(Math.min(maxPx, Math.max(minPx, px)));
}
