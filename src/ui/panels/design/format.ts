/** Formatting helpers for the Surfaces / Paint / Materials panels (pure). */
import type { CostEstimate, CostUnit } from '../../../../shared/types';
import type { AreaMethod } from '../../../assetList/area';

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "≈ 142 sq ft", "≈ 8.5 sq ft", "≈ 1,240 sq ft". */
export function formatSqFt(sqft: number): string {
  if (!Number.isFinite(sqft) || sqft <= 0) return '0 sq ft';
  const v = sqft < 10 ? Math.round(sqft * 10) / 10 : Math.round(sqft);
  return `≈ ${v.toLocaleString('en-US')} sq ft`;
}

export const AREA_METHOD_LABELS: Record<AreaMethod, string> = {
  override: 'entered by you',
  plane: 'measured on the perspective plane',
  calibration: 'estimated from the photo scale',
  none: 'unknown',
};

/** Share of the photo (0..1) as a friendly percentage. */
export function formatShare(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share < 0.01) return '< 1%';
  if (share > 0.99 && share < 1) return '> 99%';
  return `${Math.round(share * 100)}%`;
}

/** 7.5 -> "7.5", 72 -> "72", 0.375 -> "0.38". */
function trimNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return String(Math.round(v * 10 ** digits) / 10 ** digits);
}

/** Inches: 7.5 -> 7.5″, 0.375 -> 0.38″. */
export function formatInches(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${trimNumber(v, v < 1 ? 2 : 1)}″`;
}

/** "7.5 × 72 in". */
export function formatUnitSize(w: number, h: number): string {
  if (!(w > 0) || !(h > 0)) return '—';
  return `${trimNumber(w, w < 1 ? 2 : 1)} × ${trimNumber(h, h < 1 ? 2 : 1)} in`;
}

/** Feet with one decimal, trailing ".0" dropped: 12 -> "12 ft", 3.25 -> "3.3 ft". */
export function formatFeet(ft: number): string {
  if (!Number.isFinite(ft) || ft <= 0) return '—';
  if (ft < 1) return `${Math.round(ft * 12 * 10) / 10} in`;
  return `${Math.round(ft * 10) / 10} ft`;
}

export function formatScale(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '1×';
  const v = scale >= 10 ? Math.round(scale) : Math.round(scale * 100) / 100;
  return `${v}×`;
}

export function formatDegrees(deg: number): string {
  return `${Math.round(Number.isFinite(deg) ? deg : 0)}°`;
}

export const COST_UNIT_LABELS: Record<CostUnit, string> = {
  each: 'each',
  gal: 'gal',
  sqft: 'sq ft',
  lnft: 'lin ft',
  cuyd: 'cu yd',
  ton: 'ton',
  bag: 'bag',
  flat: 'flat',
  hour: 'hr',
};

function usd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const opts: Intl.NumberFormatOptions = Number.isInteger(v) || v >= 100 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...opts }).format(v);
}

/** "$3–$6 / sq ft", "$45 / cu yd", "" when unknown. */
export function formatCostRange(cost: CostEstimate | undefined): string {
  if (!cost || !Number.isFinite(cost.low) || !Number.isFinite(cost.high)) return '';
  const lo = Math.min(cost.low, cost.high);
  const hi = Math.max(cost.low, cost.high);
  const unit = COST_UNIT_LABELS[cost.unit] ?? cost.unit;
  const range = lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`;
  return `${range} / ${unit}`;
}
