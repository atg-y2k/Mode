/**
 * Small builders shared by the catalog data files. Pure and DOM-free.
 *
 * Every built-in asset's `aspect` is computed from its procedural art (never
 * typed in by hand), so the compositor, thumbnails and placement math always
 * agree with what renderArt() draws.
 */
import type { ArtSpec } from '../../../shared/art';
import type { AssetDef } from '../../../shared/types';
import { artSize } from '../art';

/**
 * Width / height of the SVG renderArt(art) produces. Uses the art module's
 * artSize(), which returns exactly renderArt()'s width/height without building
 * the SVG string (the catalog has ~170 assets and is loaded by the server, so
 * drawing them all at import time would be wasteful). The catalog tests assert
 * equality with renderArt() for every asset.
 */
export function artAspect(art: ArtSpec): number {
  const { width, height } = artSize(art);
  return width / height;
}

/** Rounds to `digits` decimals (keeps derived sizes tidy in the UI and prompts). */
export function roundTo(n: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

/** "Boxwood 'Green Velvet'" → "boxwood-green-velvet". */
export function kebab(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Native to the US / Canada (what "native plant" means for a US landscape),
 * judged from PlantInfo.native, e.g. "Eastern US", "Texas & northeastern
 * Mexico", "Rocky Mountains (species)". Hybrids and exotics are not;
 * cultivars of native species ("nativars") are.
 */
export function isUsNative(native: string | undefined): boolean {
  if (!native || /^hybrid/i.test(native)) return false;
  return /\b(US|Canada|Texas|Arizona|New Mexico|Rocky Mountains|Florida)\b/.test(native);
}

/**
 * Input for a built-in asset: everything but the derived fields. Give the
 * real-world size either as `realHeightFt` or — for wide, low things whose
 * width is the familiar dimension (rugs, recessed lights, LED strips) — as
 * `realWidthFt`; the height is then derived from the art's aspect so the
 * object lands on the photo at its true width.
 */
export type BuiltinAssetInput = Omit<AssetDef, 'aspect' | 'source' | 'realHeightFt' | 'art'> & {
  art: ArtSpec;
} & ({ realHeightFt: number; realWidthFt?: undefined } | { realWidthFt: number; realHeightFt?: undefined });

export function builtinAsset(input: BuiltinAssetInput): AssetDef {
  const { realWidthFt, realHeightFt, ...rest } = input;
  const aspect = artAspect(input.art);
  const height = realHeightFt ?? roundTo((realWidthFt as number) / aspect, 2);
  return { ...rest, source: 'builtin', aspect, realHeightFt: height };
}
