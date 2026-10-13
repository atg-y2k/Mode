/**
 * Light helpers shared by the Lighting / Library panels: what a placement
 * carries, generic glows, beam switching and color-temperature colors.
 * Pure (no store, no DOM) except for the kelvin → CSS conversion which only
 * uses the engine's color math.
 */
import type { AssetDef, LightBeam, LightInfo, PlacedLight } from '../../../../shared/types';
import { kelvinToRgb } from '../../../engine/color';

/** Shape of store.placement for lights (kept local so this file stays store-free). */
export interface LightPlacement {
  kind: 'light';
  assetId?: string;
  name: string;
  beam: LightBeam;
  kelvin: number;
}

/** Defaults used when a lighting asset has no LightInfo (e.g. an uploaded fixture photo). */
export const DEFAULT_FIXTURE_KELVIN = 2700;
export const DEFAULT_FIXTURE_BEAM: LightBeam = 'omni';

/** Placement for a fixture asset: carries the asset id, its name, beam and color temperature. */
export function lightPlacementForAsset(asset: AssetDef): LightPlacement {
  return {
    kind: 'light',
    assetId: asset.id,
    name: asset.name,
    beam: asset.light?.beam ?? DEFAULT_FIXTURE_BEAM,
    kelvin: asset.light?.kelvin ?? DEFAULT_FIXTURE_KELVIN,
  };
}

export interface GenericGlow {
  id: string;
  name: string;
  beam: LightBeam;
  kelvin: number;
  /** Two or three words for the card. */
  short: string;
  /** Tooltip: what it's good for. */
  hint: string;
}

/** Light without fixture art: just the glow. */
export const GENERIC_GLOWS: readonly GenericGlow[] = [
  { id: 'glow-omni', name: 'Glow', beam: 'omni', kelvin: 2700, short: 'Round glow', hint: 'Soft round glow — lamps, lanterns, lit windows' },
  { id: 'glow-spot', name: 'Spotlight', beam: 'spot', kelvin: 3000, short: 'Aimed beam', hint: 'Aimed beam — art, trees, house numbers' },
  { id: 'glow-strip', name: 'Light strip', beam: 'strip', kelvin: 3000, short: 'Drag a line', hint: 'Even line of light — under cabinets, coves, steps' },
  { id: 'glow-string', name: 'String lights', beam: 'string', kelvin: 2200, short: 'Drag end to end', hint: 'Bulbs hanging between two points — patios, pergolas' },
];

export function glowPlacement(g: GenericGlow): LightPlacement {
  return { kind: 'light', name: g.name, beam: g.beam, kelvin: g.kelvin };
}

export function isLineBeam(beam: LightBeam): boolean {
  return beam === 'strip' || beam === 'string';
}

/** Two placements are the same armed item (so a second tap disarms it). */
export function samePlacement(
  a: { kind: 'object'; assetId: string } | LightPlacement | null,
  b: { kind: 'object'; assetId: string } | LightPlacement | null,
): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'object' && b.kind === 'object') return a.assetId === b.assetId;
  if (a.kind === 'light' && b.kind === 'light') {
    if (a.assetId || b.assetId) return a.assetId === b.assetId;
    return a.beam === b.beam && a.name === b.name;
  }
  return false;
}

/**
 * Patch for switching a light's beam: line beams get an end point, spots an
 * angle and spread, so the light stays visible and editable.
 */
export function beamChangePatch(light: PlacedLight, beam: LightBeam): Partial<Omit<PlacedLight, 'id'>> {
  const patch: Partial<Omit<PlacedLight, 'id'>> = { beam };
  if (isLineBeam(beam) && (light.x2 === undefined || light.y2 === undefined)) {
    const len = Math.max(40, light.radius * 0.8);
    patch.x2 = light.x + len;
    patch.y2 = light.y;
  }
  if (beam === 'spot') {
    if (light.angle === undefined) patch.angle = 90;
    if (light.spread === undefined) patch.spread = 40;
  }
  return patch;
}

/** Copy of a light, nudged so it doesn't sit exactly on top of the original. */
export function duplicateLightData(light: PlacedLight, offset: number): Omit<PlacedLight, 'id'> {
  const { id: _id, ...rest } = light;
  return {
    ...rest,
    x: light.x + offset,
    y: light.y + offset,
    x2: light.x2 !== undefined ? light.x2 + offset : undefined,
    y2: light.y2 !== undefined ? light.y2 + offset : undefined,
  };
}

/** Light info for user / AI lighting assets from the few choices the forms offer. */
export function lightInfoFrom(beam: LightBeam, kelvin: number, prev?: LightInfo): LightInfo {
  return {
    beam,
    kelvin,
    lumens: prev?.lumens ?? 800,
    reachFt: prev?.reachFt ?? (beam === 'spot' || beam === 'up' ? 15 : 10),
    emitterY: prev?.emitterY ?? (beam === 'up' ? 0.85 : beam === 'down' ? 0.75 : 0.4),
    indoor: prev?.indoor ?? true,
    outdoor: prev?.outdoor ?? true,
    mountHeightFt: prev?.mountHeightFt,
  };
}

// ---------------------------------------------------------------------------
// Color-temperature colors (data colors, not theme colors)
// ---------------------------------------------------------------------------

/** CSS color of a light at a color temperature. */
export function kelvinCss(kelvin: number): string {
  const c = kelvinToRgb(kelvin);
  return `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)})`;
}

/** Relative luminance-ish check so labels on a kelvin chip stay readable (kelvin colors are all light). */
export function kelvinTextColor(kelvin: number): string {
  const c = kelvinToRgb(kelvin);
  const y = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return y > 0.55 ? '#1f1d1a' : '#ffffff';
}

/** Left-to-right gradient across a kelvin range (warm → cool). */
export function kelvinGradient(min: number, max: number, stops = 9): string {
  const parts: string[] = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    parts.push(`${kelvinCss(min + (max - min) * t)} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
