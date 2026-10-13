/**
 * Procedural SVG art for built-in assets (plants, light fixtures, decor).
 * Pure string generation — usable in the browser, tests and the server.
 */
import type { ArtResult, ArtSpec } from '../../../shared/art';
import { renderPlant } from './plants';
import { hashString, normalizeSeed } from './util';

export function renderArt(spec: ArtSpec): ArtResult {
  const key = JSON.stringify(spec);
  const prefix = 'm' + hashString(key).toString(36) + '-';
  if (spec.kind === 'plant') return renderPlant(spec, prefix, normalizeSeed(spec.seed) ^ hashString(spec.form));
  throw new Error('not yet');
}

export function tintArt(spec: ArtSpec, hex: string): ArtSpec {
  void hex;
  return spec;
}
