/**
 * The compact site header on planting elements (borrowed from Neighborbrite):
 * "Zone 7a · Part sun (5 h) · Deer: high" — the three facts that decide which
 * plants can thrive in the spot, each with what to do when it is missing.
 * Pure; unit-tested.
 */
import type { ElementDimension, ElementSpec, ElementType, ProjectLocation, SceneMap, SceneZone, SunExposure } from '../../../../shared/types';
import { dominantSun, parseHardinessZone, type FeasibilityContext } from '../../../assets/design';

/** Elements that are planting by nature (their header shows even before a plant option is picked). */
export const PLANTING_ELEMENT_TYPES: readonly ElementType[] = ['planting-bed', 'trees-shrubs', 'lawn'];

/**
 * Planting elements: the planting types, plus any element whose chosen
 * options imply plants (e.g. Border edging → "low plant edge"), outdoors.
 */
export function isPlantingElement(
  el: Pick<ElementSpec, 'type' | 'choices'>,
  dims: readonly Pick<ElementDimension, 'id' | 'options'>[],
  setting: 'interior' | 'exterior',
): boolean {
  if (setting !== 'exterior') return false;
  if (PLANTING_ELEMENT_TYPES.includes(el.type)) return true;
  return dims.some((d) => d.options.some((o) => o.feasibility && (el.choices[d.id] ?? []).includes(o.id)));
}

const SUN_TEXT: Record<SunExposure, string> = { 'full-sun': 'Full sun', 'part-sun': 'Part sun', shade: 'Shade' };

/** 5.24 → "5 h", 0.4 → "<1 h", 2.5 → "2½ h". */
export function formatHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return '';
  if (h > 0 && h < 1) return '<1 h';
  const halves = Math.round(h * 2) / 2;
  const whole = Math.floor(halves);
  return halves - whole && whole < 4 ? `${whole}½ h` : `${Math.round(h)} h`;
}

/**
 * The zones that decide the spot's sun: the element's own zones that have a
 * sun rating, else the brief's target zones (same rule as plan feasibility).
 */
export function spotZones(el: Pick<ElementSpec, 'zoneIds'>, scene: SceneMap | undefined, fallbackZoneIds: readonly string[] = []): SceneZone[] {
  const zones = scene?.zones ?? [];
  const own = zones.filter((z) => el.zoneIds.includes(z.id) && z.sun);
  return own.length ? own : zones.filter((z) => fallbackZoneIds.includes(z.id) && z.sun);
}

export type HeaderGap = 'zip' | 'sun' | 'deer';

export interface SiteHeader {
  /** "Zone 7a" — null when the property's zone is unknown. */
  zone: string | null;
  /** "Part sun (5 h)" — null when the spot's sun is unknown. */
  sun: string | null;
  exposure: SunExposure | null;
  /** Average estimated direct-sun hours of the spot (zones with sunHours). */
  hours: number | null;
  /** "Deer: high" — null when unknown. */
  deer: string | null;
  /** What is missing, in display order. */
  gaps: HeaderGap[];
  /** Plain one-liner ("Zone 7a · Part sun (5 h) · Deer: high"), for titles and screen readers. */
  text: string;
}

/** Deer pressure: the Settings choice, else what the AI climate profile's notes say. */
export function deerOf(location: ProjectLocation | undefined, ctx?: Pick<FeasibilityContext, 'deerPressure'>): 'low' | 'medium' | 'high' | null {
  if (location?.deerPressure) return location.deerPressure;
  const fromCtx = ctx?.deerPressure;
  if (fromCtx === true) return 'medium';
  if (fromCtx === false) return 'low';
  return fromCtx ?? null;
}

export function siteHeader(location: ProjectLocation | undefined, spot: readonly Pick<SceneZone, 'sun' | 'sunHours'>[], ctx?: Pick<FeasibilityContext, 'deerPressure'>): SiteHeader {
  const zoneLabel = (location?.climate?.hardinessZone ?? location?.hardinessZone)?.trim();
  const zone = zoneLabel && parseHardinessZone(zoneLabel) !== undefined ? `Zone ${zoneLabel.replace(/^zone\s*/i, '')}` : null;
  const exposure = dominantSun(spot) ?? null;
  const withHours = spot.filter((z) => typeof z.sunHours === 'number' && Number.isFinite(z.sunHours) && z.sun === exposure);
  const hours = withHours.length ? withHours.reduce((s, z) => s + (z.sunHours as number), 0) / withHours.length : null;
  const sun = exposure ? `${SUN_TEXT[exposure]}${hours !== null ? ` (${formatHours(hours)})` : ''}` : null;
  const deerLevel = deerOf(location, ctx);
  const deer = deerLevel ? `Deer: ${deerLevel}` : null;
  const gaps: HeaderGap[] = [];
  if (!zone) gaps.push('zip');
  if (!sun) gaps.push('sun');
  if (!deer) gaps.push('deer');
  const text = [zone ?? 'Zone unknown', sun ?? 'Sun not set', deer ?? 'Deer pressure unknown'].join(' · ');
  return { zone, sun, exposure, hours, deer, gaps, text };
}

/**
 * The feasibility context with the project's deer-pressure setting applied
 * (Settings wins over what the AI climate notes imply), so option ratings
 * agree with the header.
 */
export function withSiteDeer(ctx: FeasibilityContext, location: ProjectLocation | undefined): FeasibilityContext {
  return location?.deerPressure && ctx.deerPressure !== location.deerPressure ? { ...ctx, deerPressure: location.deerPressure } : ctx;
}
