/**
 * Import pipeline (pure given decoded pixels and an optional OpenCV module):
 * returned image → aligned, colour-corrected, feathered composite on the
 * photo + alignment report + outside-change map. Runs in the align worker,
 * on the main thread as a fallback, and in node tests.
 *
 * 1. Initial mapping photo → returned from the pack's crop and the returned
 *    size (stretch when the aspect matches, else centred "cover").
 * 2. ORB + RANSAC affine refinement at ~1024 px (alignCore), target masked.
 * 3. Warp the returned image onto the crop region (pre-shrunk with an
 *    antialiased resample, then bilinear).
 * 4. Per-channel gain/offset fitted outside the target, applied everywhere.
 * 5. Feathered composite inside the composite band; original elsewhere.
 * 6. Blurred ΔE change map outside the target at ~512 px.
 */
import type { AlignmentReport } from '../../shared/types';
import { growMask } from '../engine/mask';
import type { ImageDataLike, Mask } from '../engine/types';
import { alignFeatures, type AlignResult } from './alignCore';
import { BAND_EDGE_THRESHOLD, compositeBand, distanceSquared, isWholeCoverage, markerMarginPhotoPx, maskCoverageShare } from './bands';
import { applyChannelFit, fitChannels, IDENTITY_FIT, meanDeltaE, type ChannelFit } from './colorMatch';
import { outsideChanges } from './changeMap';
import type { CvLike } from './cv';
import {
  affineScale,
  composeAffine,
  invertAffine,
  maskAsGray,
  resampleGray,
  resampleRGBA,
  toGray,
  warpAffineRGBA,
  type Affine,
  type Rect,
} from './resample';

/** Long edge (px) at which features are matched. */
export const ALIGN_EDGE = 1024;
/** Long edge (px) of the region the change map is computed at. */
export const CHANGE_EDGE = 512;
/** Margin (working px) masked around the target on the original for feature detection. */
export const ALIGN_TARGET_MARGIN = 20;

export interface ImportResult {
  /** Final image at photo size: original outside the target, the returned edit inside (aligned, color-corrected, feathered). */
  composite: ImageDataLike;
  report: AlignmentReport;
  /** 0..255 per pixel at photo size (or downscaled): where the model changed things OUTSIDE the target (for a toggleable heatmap). */
  outsideChangeMap: { width: number; height: number; data: Uint8Array };
  /** Bounding boxes (photo px) of notable outside changes, largest first. */
  outsideBlobs: { x: number; y: number; w: number; h: number; area: number }[];
  /** Photo px → returned-image px transform that was used (continuous coords). */
  transform?: Affine;
  /** The per-channel colour correction applied to the returned image. */
  colorFit?: ChannelFit;
  /** Why feature alignment was not trusted ('' when aligned). */
  alignNote?: string;
}

export interface ImportJob {
  /** Base pixels at photo size (original photo or the base variation). */
  original: ImageDataLike;
  /** Target mask at photo size — the same one the hand-off was prepared with. */
  target: Mask;
  /** Exported region of the photo (photo px) and export size. */
  crop: Rect;
  outW: number;
  outH: number;
  /** The decoded image the user brought back. */
  returned: ImageDataLike;
}

export type ImportStage = 'aligning' | 'compositing';

/**
 * Initial photo → returned mapping from the export geometry alone: the
 * export was `crop` resized to the returned image; when the app changed the
 * aspect ratio (> 3 %) assume it kept the centre and cropped ("cover").
 */
export function plainMapping(crop: Rect, returnedW: number, returnedH: number): Affine {
  const sx = returnedW / crop.w;
  const sy = returnedH / crop.h;
  if (Math.abs(Math.log(sx / sy)) < 0.03) return [sx, 0, -crop.x * sx, 0, sy, -crop.y * sy];
  const s = Math.max(sx, sy);
  const ox = (returnedW - crop.w * s) / 2;
  const oy = (returnedH - crop.h * s) / 2;
  return [s, 0, ox - crop.x * s, 0, s, oy - crop.y * s];
}

function normalizeCrop(crop: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.min(W - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(H - 1, Math.round(crop.y)));
  const w = Math.max(1, Math.min(W - x, Math.round(crop.w)));
  const h = Math.max(1, Math.min(H - y, Math.round(crop.h)));
  return { x, y, w, h };
}

function regionOf(img: ImageDataLike, r: Rect): ImageDataLike {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(s, s + r.w * 4), y * r.w * 4);
  }
  return { width: r.w, height: r.h, data: out };
}

function regionMask(m: Mask, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const s = (r.y + y) * m.width + r.x;
    out.set(m.data.subarray(s, s + r.w), y * r.w);
  }
  return out;
}

/** Evenly strided subset of the indices where `pick` is true, at most `max` long. */
function sampleIndices(n: number, pick: (i: number) => boolean, max: number): Uint32Array {
  let count = 0;
  for (let i = 0; i < n; i++) if (pick(i)) count++;
  const stride = Math.max(1, Math.ceil(count / max));
  const out = new Uint32Array(Math.ceil(count / stride));
  let k = 0;
  let seen = 0;
  for (let i = 0; i < n && k < out.length; i++) {
    if (!pick(i)) continue;
    if (seen++ % stride === 0) out[k++] = i;
  }
  return out.subarray(0, k);
}

/**
 * Feature masks for alignment: on the original working image, the target
 * (+ margin) is excluded; on the returned one, the same area projected with
 * the initial guess (+ a generous extra margin for guess error). A mask
 * leaving < 15 % of the image is dropped (whole-image edits).
 */
function featureMasks(
  target: Mask,
  crop: Rect,
  ow: number,
  oh: number,
  rw: number,
  rh: number,
  guess: Affine,
): { original: Uint8Array | null; returned: Uint8Array | null } {
  const small = resampleGray(maskAsGray(target), crop, ow, oh);
  const excluded: Mask = { width: ow, height: oh, data: new Uint8Array(ow * oh) };
  for (let i = 0; i < small.data.length; i++) excluded.data[i] = small.data[i] > 0 ? 255 : 0;
  growMask(excluded, ALIGN_TARGET_MARGIN);
  const original = new Uint8Array(ow * oh);
  let allowed = 0;
  for (let i = 0; i < original.length; i++) {
    if (excluded.data[i] < 128) {
      original[i] = 255;
      allowed++;
    }
  }
  if (allowed < 0.15 * original.length) return { original: null, returned: null };
  // Returned side: project the (further grown) exclusion with the guess.
  growMask(excluded, Math.round(Math.max(ow, oh) * 0.03));
  const inv = invertAffine(guess);
  if (!inv) return { original, returned: null };
  const returned = new Uint8Array(rw * rh);
  let allowedR = 0;
  for (let v = 0; v < rh; v++) {
    for (let u = 0; u < rw; u++) {
      const x = inv[0] * (u + 0.5) + inv[1] * (v + 0.5) + inv[2];
      const y = inv[3] * (u + 0.5) + inv[4] * (v + 0.5) + inv[5];
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const blocked = xi >= 0 && yi >= 0 && xi < ow && yi < oh && excluded.data[yi * ow + xi] >= 128;
      if (!blocked) {
        returned[v * rw + u] = 255;
        allowedR++;
      }
    }
  }
  return { original, returned: allowedR < 0.15 * returned.length ? null : returned };
}

/** Runs the whole import. `cv` null = no feature alignment (plain mapping, aligned: false). */
export function runImport(cv: CvLike | null, job: ImportJob, onStage?: (stage: ImportStage) => void): ImportResult {
  const { original, target, returned } = job;
  const W = original.width;
  const H = original.height;
  if (target.width !== W || target.height !== H) {
    throw new Error(`importHandoffResult: mask ${target.width}×${target.height} does not match the photo ${W}×${H}`);
  }
  if (returned.width < 8 || returned.height < 8) throw new Error('The returned image is too small to use.');
  const crop = normalizeCrop(job.crop, W, H);
  const rw = returned.width;
  const rh = returned.height;
  const coverage = maskCoverageShare(target);
  const whole = isWholeCoverage(coverage);

  // 1. Initial mapping (photo → returned).
  const plain = plainMapping(crop, rw, rh);

  // 2. Feature alignment at ~1024 px.
  onStage?.('aligning');
  const ko = Math.min(1, ALIGN_EDGE / Math.max(crop.w, crop.h));
  const ow = Math.max(16, Math.round(crop.w * ko));
  const oh = Math.max(16, Math.round(crop.h * ko));
  const kr = Math.min(ko / affineScale(plain), (ALIGN_EDGE * 1.5) / Math.max(rw, rh));
  const rWw = Math.max(16, Math.round(rw * kr));
  const rWh = Math.max(16, Math.round(rh * kr));
  // Photo → original working, returned → returned working.
  const toO: Affine = [ow / crop.w, 0, (-crop.x * ow) / crop.w, 0, oh / crop.h, (-crop.y * oh) / crop.h];
  const toR: Affine = [rWw / rw, 0, 0, 0, rWh / rh, 0];
  const fromO = invertAffine(toO) as Affine;
  const fromR = invertAffine(toR) as Affine;
  const guess = composeAffine(toR, composeAffine(plain, fromO));

  let align: AlignResult = {
    matrix: guess,
    fitted: null,
    accepted: false,
    matches: 0,
    inliers: 0,
    inlierRatio: 0,
    residualPx: 0,
    reason: 'feature alignment unavailable',
  };
  if (cv) {
    const grayO = resampleGray(toGray(original), crop, ow, oh);
    const grayR = resampleGray(toGray(returned), { x: 0, y: 0, w: rw, h: rh }, rWw, rWh);
    const masks = whole ? { original: null, returned: null } : featureMasks(target, crop, ow, oh, rWw, rWh, guess);
    align = alignFeatures(cv, grayO, grayR, masks.original, guess, { returnedMask: masks.returned });
  }
  const workingMap = align.accepted ? align.matrix : guess;
  const M = composeAffine(fromR, composeAffine(workingMap, toO)); // photo → returned (full res)
  const residualPx = align.fitted ? align.residualPx / (ow / crop.w) : 0;

  // 3. Warp the returned image onto the crop region.
  onStage?.('compositing');
  let src = returned;
  let Msrc = M;
  const s = affineScale(M);
  if (s > 1.25) {
    const sw = Math.max(1, Math.round(rw / s));
    const sh = Math.max(1, Math.round(rh / s));
    src = resampleRGBA(returned, { x: 0, y: 0, w: rw, h: rh }, sw, sh);
    Msrc = composeAffine([sw / rw, 0, 0, 0, sh / rh, 0], M);
  }
  const warp = warpAffineRGBA(src, Msrc, crop.w, crop.h, crop.x, crop.y);
  // Erode validity by 2 px: edge pixels of a returned image are often soft or dark.
  const valid: Mask = { width: crop.w, height: crop.h, data: warp.valid };
  for (let i = 0; i < valid.data.length; i++) valid.data[i] = 255 - valid.data[i];
  growMask(valid, 2);
  for (let i = 0; i < valid.data.length; i++) valid.data[i] = valid.data[i] >= 128 ? 0 : 255;

  // Band, marker ring and protected pixels (crop region).
  const band = compositeBand(target, coverage);
  const bandC = regionMask(band, crop);
  const n = crop.w * crop.h;
  const isProtected = new Uint8Array(n);
  if (!whole) {
    const ringPx = markerMarginPhotoPx(Math.max(job.outW, job.outH), job.outW / crop.w) + 2;
    const dist2 = distanceSquared(crop.w, crop.h, (i) => bandC[i] >= BAND_EDGE_THRESHOLD);
    const ring2 = ringPx * ringPx;
    for (let i = 0; i < n; i++) if (bandC[i] === 0 && valid.data[i] === 255 && dist2[i] > ring2) isProtected[i] = 255;
  }

  // 4. Colour correction fitted outside the target.
  const origC = regionOf(original, crop);
  const corrected = warp.image;
  const samples = sampleIndices(n, (i) => isProtected[i] === 255, 200_000);
  let fit: ChannelFit = { gain: [...IDENTITY_FIT.gain], offset: [...IDENTITY_FIT.offset] };
  let driftBefore = 0;
  let driftAfter = 0;
  if (samples.length >= 500) {
    driftBefore = meanDeltaE(origC, corrected, samples);
    const candidate = fitChannels(corrected, origC, samples);
    const after = meanDeltaE(origC, corrected, samples, 0.1, candidate);
    // Never make it worse (e.g. when the model changed most of the surroundings).
    if (after < driftBefore) {
      fit = candidate;
      applyChannelFit(corrected, fit, valid.data);
      driftAfter = after;
    } else driftAfter = driftBefore;
  }

  // 5. Feathered composite inside the band.
  const out = new Uint8ClampedArray(original.data);
  const cd = corrected.data;
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const i = y * crop.w + x;
      const m = (bandC[i] * valid.data[i]) / 65025;
      if (m <= 0) continue;
      const p = ((crop.y + y) * W + crop.x + x) * 4;
      const q = i * 4;
      if (m >= 1) {
        out[p] = cd[q];
        out[p + 1] = cd[q + 1];
        out[p + 2] = cd[q + 2];
      } else {
        out[p] = out[p] + (cd[q] - out[p]) * m;
        out[p + 1] = out[p + 1] + (cd[q + 1] - out[p + 1]) * m;
        out[p + 2] = out[p + 2] + (cd[q + 2] - out[p + 2]) * m;
      }
    }
  }

  // 6. Outside-change map at ~512 px (photo frame).
  const km = Math.min(1, CHANGE_EDGE / Math.max(crop.w, crop.h), (CHANGE_EDGE * 2) / Math.max(W, H));
  const mapW = Math.max(1, Math.round(W * km));
  const mapH = Math.max(1, Math.round(H * km));
  const mapData = new Uint8Array(mapW * mapH);
  const blobs: ImportResult['outsideBlobs'] = [];
  let outsideChanged = 0;
  if (!whole && samples.length >= 500) {
    const mw = Math.max(1, Math.round(crop.w * km));
    const mh = Math.max(1, Math.round(crop.h * km));
    const full: Rect = { x: 0, y: 0, w: crop.w, h: crop.h };
    const smallO = resampleRGBA(origC, full, mw, mh);
    const smallR = resampleRGBA(corrected, full, mw, mh);
    const smallP = resampleGray({ width: crop.w, height: crop.h, data: isProtected }, full, mw, mh).data;
    for (let i = 0; i < smallP.length; i++) smallP[i] = smallP[i] >= 250 ? 255 : 0;
    const changes = outsideChanges(smallO, smallR, smallP);
    outsideChanged = changes.changedShare;
    const ox = Math.round(crop.x * km);
    const oy = Math.round(crop.y * km);
    for (let y = 0; y < mh; y++) {
      const ty = oy + y;
      if (ty < 0 || ty >= mapH) continue;
      for (let x = 0; x < mw; x++) {
        const tx = ox + x;
        if (tx < 0 || tx >= mapW) continue;
        mapData[ty * mapW + tx] = changes.map[y * mw + x];
      }
    }
    const sxPhoto = crop.w / mw;
    const syPhoto = crop.h / mh;
    for (const b of changes.blobs.slice(0, 20)) {
      blobs.push({
        x: Math.round(crop.x + b.x * sxPhoto),
        y: Math.round(crop.y + b.y * syPhoto),
        w: Math.round(b.w * sxPhoto),
        h: Math.round(b.h * syPhoto),
        area: Math.round(b.area * sxPhoto * syPhoto),
      });
    }
  }

  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    composite: { width: W, height: H, data: out },
    report: {
      inliers: align.inliers,
      residualPx: round2(residualPx),
      driftBefore: round2(driftBefore),
      driftAfter: round2(driftAfter),
      outsideChanged: Math.round(outsideChanged * 1000) / 1000,
      aligned: align.accepted,
    },
    outsideChangeMap: { width: mapW, height: mapH, data: mapData },
    outsideBlobs: blobs,
    transform: M,
    colorFit: fit,
    alignNote: align.accepted ? '' : align.reason,
  };
}
