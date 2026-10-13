/**
 * Procedural SVG art for built-in assets (plants, light fixtures, decor).
 * Pure string generation — usable in the browser, tests and the server.
 *
 * Style: clean, slightly stylized "architectural illustration" look that sits
 * well on photos — layered organic shapes with 2-3 tones, soft inner shading
 * via gradients, no outlines/strokes heavier than ~1.5px, transparent background.
 * Output is deterministic for a given spec (seeded PRNG), and every def id is
 * prefixed with a hash of the spec so several SVGs can share one document.
 */
import type { ArtResult, ArtSpec, DecorArt, FixtureArt, PlantArt } from '../../../shared/art';
import { decorSize, renderDecor } from './decor';
import { fixtureSize, renderFixture } from './fixtures';
import { plantSize, renderPlant } from './plants';
import { hashString, isHex, normHex, normalizeSeed, transferTint } from './util';

export { FIXTURE_EMITTER_Y } from './fixtures';

/** Small LRU of rendered results (thumbnails and the compositor ask repeatedly). */
const CACHE_MAX = 256;
const cache = new Map<string, ArtResult>();

/** Canonical JSON (sorted keys, no undefined) so equal specs share ids and cache entries. */
function specKey(spec: ArtSpec): string {
  const rec = spec as unknown as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return JSON.stringify(keys.map((k) => [k, rec[k]]));
}

export function renderArt(spec: ArtSpec): ArtResult {
  const key = specKey(spec);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return { ...hit };
  }
  const hash = hashString(key);
  const prefix = 'm' + hash.toString(36) + '-';
  let out: ArtResult;
  switch (spec.kind) {
    case 'plant':
      out = renderPlant(spec, prefix, (normalizeSeed(spec.seed) ^ hashString(spec.form)) >>> 0);
      break;
    case 'fixture':
      out = renderFixture(spec, prefix);
      break;
    case 'decor':
      out = renderDecor(spec, prefix, (normalizeSeed(spec.seed) ^ hashString(spec.form)) >>> 0);
      break;
    default: {
      // Unknown kind (corrupt data): neutral placeholder rather than a crash.
      out = renderDecor({ kind: 'decor', form: 'boulder', color: '#9a9a9a', seed: 0 }, prefix, hash);
    }
  }
  cache.set(key, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return { ...out };
}

/**
 * Size and anchor of the art for a spec without drawing it (cheap; use it to
 * compute AssetDef.aspect = width / height for catalogs). Always equal to the
 * corresponding renderArt() fields; colors never affect the size.
 */
export function artSize(spec: ArtSpec): Omit<ArtResult, 'svg'> {
  switch (spec.kind) {
    case 'plant':
      return plantSize(spec);
    case 'fixture':
      return fixtureSize(spec);
    case 'decor':
      return decorSize(spec);
    default:
      return decorSize({ kind: 'decor', form: 'boulder', color: '#9a9a9a', seed: 0 });
  }
}

/**
 * Replace the main color of a spec (foliage / finish / color) — used for tinting placed objects.
 * Secondary colors that belong to the same material (a plant's highlight foliage)
 * follow the same hue/lightness shift so the two tones stay coherent.
 * Invalid hex input returns the spec unchanged.
 */
export function tintArt(spec: ArtSpec, hex: string): ArtSpec {
  if (!isHex(hex)) return spec;
  const to = normHex(hex, '#808080');
  switch (spec.kind) {
    case 'plant': {
      const next: PlantArt = { ...spec, foliage: to };
      if (spec.foliage2 && isHex(spec.foliage2) && isHex(spec.foliage)) next.foliage2 = transferTint(normHex(spec.foliage2, to), normHex(spec.foliage, to), to);
      return next;
    }
    case 'fixture': {
      const next: FixtureArt = { ...spec, finish: to };
      return next;
    }
    case 'decor': {
      const next: DecorArt = { ...spec, color: to };
      return next;
    }
    default:
      return spec;
  }
}
