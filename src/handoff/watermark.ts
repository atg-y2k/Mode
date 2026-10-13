/**
 * Gemini's visible watermark: the Gemini app stamps a small sparkle in the
 * BOTTOM-RIGHT corner of the images it makes (free and AI Pro plans; it can
 * be switched off in Gemini's Settings → Media watermark since 2026-08,
 * except in the EU and South Korea). Mode's composite only keeps returned
 * pixels inside the composite band, so the sparkle disappears by itself —
 * unless the band reaches that corner of the exported frame. This module
 * answers "does it?" so the companion can warn before the hand-off.
 *
 * The corner size is an estimate (the sparkle sits ~3–5 % of the long edge
 * in from the corner); unverified against every output size.
 */
import type { Mask } from '../engine/types';
import { compositeRadii, isWholeCoverage, maskCoverageShare } from './bands';
import type { Rect } from './resample';

/** Side of the watermark corner square, as a share of the exported frame's long edge. */
export const WATERMARK_CORNER_SHARE = 0.1;
/** Target coverage (of 255) that counts as "the band reaches here" (the band's growth seed). */
const SEED = 64;

/** The bottom-right corner square of an exported frame (photo px). */
export function watermarkCorner(crop: Rect): Rect {
  const side = Math.max(1, Math.round(Math.max(crop.w, crop.h) * WATERMARK_CORNER_SHARE));
  const w = Math.min(crop.w, side);
  const h = Math.min(crop.h, side);
  return { x: crop.x + crop.w - w, y: crop.y + crop.h - h, w, h };
}

/**
 * True when the returned image's bottom-right corner lands inside what Mode
 * keeps from it: a whole-image target, or a target whose composite band
 * (target grown + feathered, see bands.ts) reaches the corner square of the
 * exported `crop`. Cheap: scans only the corner grown by the band radius.
 */
export function targetTouchesWatermark(target: Mask, crop: Rect): boolean {
  const coverage = maskCoverageShare(target);
  if (isWholeCoverage(coverage)) return true;
  const corner = watermarkCorner(crop);
  const { grow, feather } = compositeRadii(target.width, target.height, boundsOf(target));
  const reach = grow + feather;
  const x0 = Math.max(0, Math.floor(corner.x - reach));
  const y0 = Math.max(0, Math.floor(corner.y - reach));
  const x1 = Math.min(target.width, Math.ceil(corner.x + corner.w + reach));
  const y1 = Math.min(target.height, Math.ceil(corner.y + corner.h + reach));
  const d = target.data;
  for (let y = y0; y < y1; y++) {
    const row = y * target.width;
    for (let x = x0; x < x1; x++) if (d[row + x] >= SEED) return true;
  }
  return false;
}

/** Rough bounds of the target (≥ seed coverage), only for the band radii. */
function boundsOf(m: Mask): { w: number; h: number } | null {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  const step = Math.max(1, Math.round(Math.sqrt((m.width * m.height) / 250_000)));
  for (let y = 0; y < m.height; y += step) {
    const row = y * m.width;
    for (let x = 0; x < m.width; x += step) {
      if (m.data[row + x] < SEED) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
