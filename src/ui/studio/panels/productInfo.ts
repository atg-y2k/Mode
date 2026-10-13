/**
 * Real-store products on the idea board: ProductResult (search / pasted link)
 * → ProductInfo, price and store labels, and whether a plant's zone range
 * fits the property. Pure.
 */
import type { ProductResult } from '../../../../shared/api';
import { STORE_LABELS, type AssetCategory, type ProductInfo, type StoreKind } from '../../../../shared/types';
import { parseHardinessZone } from '../../../assets/design';
import { parseZones } from '../../../lib/products';
import { formatUsd } from '../../common';

export const SHOP_STORES: { kind: Exclude<StoreKind, 'other'>; label: string }[] = [
  { kind: 'home-depot', label: 'Home Depot' },
  { kind: 'lowes', label: "Lowe's" },
  { kind: 'nursery', label: 'Nurseries' },
];

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  plant: 'Plants',
  lighting: 'Lighting',
  decor: 'Decor',
  furniture: 'Furniture',
  hardscape: 'Hardscape',
  other: 'Other',
};

export function productInfoFrom(product: ProductResult, now = Date.now()): ProductInfo {
  const info: ProductInfo = {
    store: product.store.trim() || STORE_LABELS[product.storeKind],
    storeKind: product.storeKind,
    url: product.url,
    specs: product.specs.filter((s) => s.trim()).slice(0, 12),
    retrievedAt: now,
  };
  if (product.brand?.trim()) info.brand = product.brand.trim();
  if (product.priceUsd != null && Number.isFinite(product.priceUsd)) info.priceUsd = product.priceUsd;
  if (product.priceText?.trim()) info.priceText = product.priceText.trim();
  if (product.imageUrl?.trim()) info.imageUrl = product.imageUrl.trim();
  return info;
}

/** "$24.98 / 3 gal", "$129", or null when no price was found. */
export function priceLabel(p: { priceText?: string | null; priceUsd?: number | null }): string | null {
  if (p.priceText?.trim()) return p.priceText.trim();
  if (p.priceUsd != null && Number.isFinite(p.priceUsd)) return formatUsd(p.priceUsd);
  return null;
}

export function storeLabel(p: Pick<ProductInfo, 'store' | 'storeKind'>): string {
  return p.store?.trim() || STORE_LABELS[p.storeKind] || 'Store';
}

/** Host name for display ("homedepot.com"); null for an invalid URL. */
export function urlHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** A pasted http(s) link that can be sent to the server; null when it isn't one. */
export function normalizeProductUrl(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type ZoneFit = { kind: 'fits' | 'outside' | 'unknown'; text: string };

/**
 * How a plant's zone range (e.g. "5-9") relates to the property's zone
 * ("7a"). Unknown when either side is missing.
 */
export function zoneFit(productZones: string | null | undefined, projectZone: string | null | undefined): ZoneFit | null {
  const range = parseZones(productZones ?? null);
  if (!range) return null;
  const rangeText = range.min === range.max ? `Zone ${range.min}` : `Zones ${range.min}–${range.max}`;
  const zone = parseHardinessZone(projectZone ?? undefined);
  if (zone === undefined) return { kind: 'unknown', text: rangeText };
  if (zone >= range.min && zone <= range.max) return { kind: 'fits', text: `${rangeText} · fits your zone ${projectZone?.trim()}` };
  return { kind: 'outside', text: `${rangeText} · your zone ${projectZone?.trim()} is outside` };
}
