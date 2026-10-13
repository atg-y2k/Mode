/**
 * The details form shared by "Add your own", "Generate with AI" and "Edit":
 * value shape, defaults, validation and conversion to AssetDef fields. Pure.
 */
import type { AssetCategory, AssetDef, CostEstimate, LightBeam } from '../../../../shared/types';
import { lightInfoFrom } from './lights';

export interface AssetDetails {
  name: string;
  category: AssetCategory;
  /** Real-world height in feet (sizes the item when the photo is calibrated). */
  realHeightFt: number | undefined;
  costLow: number | undefined;
  costHigh: number | undefined;
  vendorUrl: string;
  description: string;
  /** Only used for category 'lighting'. */
  beam: LightBeam;
  kelvin: number;
}

/** Typical heights used to prefill the form. */
export const DEFAULT_HEIGHT_FT: Record<AssetCategory, number> = {
  plant: 3,
  lighting: 1.5,
  decor: 2.5,
  furniture: 3,
  hardscape: 2,
  other: 3,
};

export const MAX_NAME_LENGTH = 80;
export const MAX_HEIGHT_FT = 150;

/** "my_boxwood-photo (2).JPG" → "My boxwood photo (2)". */
export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words || /^(img|image|photo|dsc|pxl)\s?\d+$/i.test(words)) return '';
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return name.slice(0, MAX_NAME_LENGTH);
}

export function emptyDetails(category: AssetCategory = 'plant'): AssetDetails {
  return {
    name: '',
    category,
    realHeightFt: DEFAULT_HEIGHT_FT[category],
    costLow: undefined,
    costHigh: undefined,
    vendorUrl: '',
    description: '',
    beam: 'omni',
    kelvin: 2700,
  };
}

/** Prefill from an existing asset (Edit). */
export function detailsFromAsset(asset: AssetDef): AssetDetails {
  return {
    name: asset.name,
    category: asset.category,
    realHeightFt: asset.realHeightFt,
    costLow: asset.cost?.low,
    costHigh: asset.cost?.high,
    vendorUrl: asset.vendorUrl ?? '',
    description: asset.description ?? '',
    beam: asset.light?.beam ?? 'omni',
    kelvin: asset.light?.kelvin ?? 2700,
  };
}

/** True for an http(s) URL (or an empty string, the field being optional). */
export function isValidVendorUrl(url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface DetailErrors {
  name?: string;
  realHeightFt?: string;
  cost?: string;
  vendorUrl?: string;
}

export function validateDetails(d: AssetDetails): DetailErrors {
  const errors: DetailErrors = {};
  if (!d.name.trim()) errors.name = 'Give it a name.';
  else if (d.name.trim().length > MAX_NAME_LENGTH) errors.name = `Keep it under ${MAX_NAME_LENGTH} characters.`;
  if (d.realHeightFt === undefined || !Number.isFinite(d.realHeightFt) || d.realHeightFt <= 0) {
    errors.realHeightFt = 'Enter its height in feet — it sizes the item on calibrated photos.';
  } else if (d.realHeightFt > MAX_HEIGHT_FT) errors.realHeightFt = `That’s taller than ${MAX_HEIGHT_FT} ft.`;
  const lo = d.costLow;
  const hi = d.costHigh;
  if ((lo !== undefined && (!Number.isFinite(lo) || lo < 0)) || (hi !== undefined && (!Number.isFinite(hi) || hi < 0))) {
    errors.cost = 'Prices can’t be negative.';
  } else if (lo !== undefined && hi !== undefined && hi < lo) errors.cost = 'The high price is below the low price.';
  if (!isValidVendorUrl(d.vendorUrl)) errors.vendorUrl = 'Use a full web address starting with https://';
  return errors;
}

export function hasErrors(e: DetailErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** Cost from the optional low / high inputs (a single price fills both). */
export function costFromDetails(d: Pick<AssetDetails, 'costLow' | 'costHigh'>): CostEstimate | undefined {
  const lo = d.costLow !== undefined && Number.isFinite(d.costLow) && d.costLow >= 0 ? d.costLow : undefined;
  const hi = d.costHigh !== undefined && Number.isFinite(d.costHigh) && d.costHigh >= 0 ? d.costHigh : undefined;
  if (lo === undefined && hi === undefined) return undefined;
  const low = lo ?? hi!;
  const high = hi ?? lo!;
  return { low: Math.min(low, high), high: Math.max(low, high), unit: 'each' };
}

/**
 * AssetDef fields from the form. Every optional field is present (possibly
 * undefined) so an edit can clear it.
 */
export function detailsToFields(
  d: AssetDetails,
  prev?: AssetDef,
): Pick<AssetDef, 'name' | 'category' | 'realHeightFt' | 'cost' | 'vendorUrl' | 'description' | 'light'> {
  return {
    name: d.name.trim().slice(0, MAX_NAME_LENGTH),
    category: d.category,
    realHeightFt: d.realHeightFt && d.realHeightFt > 0 ? d.realHeightFt : DEFAULT_HEIGHT_FT[d.category],
    cost: costFromDetails(d),
    vendorUrl: d.vendorUrl.trim() || undefined,
    description: d.description.trim() || undefined,
    light: d.category === 'lighting' ? lightInfoFrom(d.beam, d.kelvin, prev?.light) : undefined,
  };
}

/** Tags for a new user / AI asset. */
export function tagsFor(category: AssetCategory, source: 'user' | 'ai', extra: readonly string[] = []): string[] {
  const tags = new Set<string>([category, source === 'ai' ? 'ai-generated' : 'uploaded']);
  for (const t of extra) {
    const v = t.trim().toLowerCase();
    if (v) tags.add(v);
  }
  return [...tags];
}

/** Width / height from SVG markup (viewBox, else width/height attributes); null if unknown. */
export function svgAspect(svg: string): number | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!open) return null;
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*["']/i.exec(open);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return w / h;
  }
  const w = Number(/\bwidth\s*=\s*["']\s*([\d.]+)/i.exec(open)?.[1]);
  const h = Number(/\bheight\s*=\s*["']\s*([\d.]+)/i.exec(open)?.[1]);
  return w > 0 && h > 0 ? w / h : null;
}

/** data: URL for showing SVG markup in an <img> (scripts never run there). */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Usable aspect ratio, falling back when a server value is missing or absurd. */
export function saneAspect(value: number | null | undefined, fallback = 1): number {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0.02 && value < 50 ? value : fallback;
}
