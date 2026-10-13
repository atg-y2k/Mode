/**
 * Deterministic plant-feasibility cross-check. Claude rates every plant it
 * uses; when a plant matches one in Mode's curated catalog, its hardiness
 * range and sun needs are checked against the property's USDA zone and the
 * sun of the targeted areas. Ratings are only ever downgraded (never raised),
 * and the reason is added to the plant's notes.
 */
import type { ElementOptionsResult, PlanRequest, PlanResult } from '../../shared/api';
import type { AssetDef, SunExposure } from '../../shared/types';

export interface CatalogPlant {
  name: string;
  botanical: string | null;
  zoneMin: number | null;
  zoneMax: number | null;
  sun: SunExposure[];
}

type Rating = 'good' | 'caution' | 'poor';
const RANK: Record<Rating, number> = { good: 0, caution: 1, poor: 2 };

export function catalogPlantsFromAssets(assets: readonly AssetDef[]): CatalogPlant[] {
  return assets
    .filter((a) => a.plant && !a.plant.indoor)
    .map((a) => ({
      name: a.name,
      botanical: a.plant?.botanical ?? null,
      zoneMin: a.plant?.zoneMin ?? null,
      zoneMax: a.plant?.zoneMax ?? null,
      sun: a.plant?.sun ?? [],
    }));
}

/** USDA zone number from "7a" / "Zone 7b" / a climate summary ("USDA zone 6a. …"); 7b → 7.5. */
export function parseZoneNumber(text: string | null | undefined): number | null {
  const m = /(?:zone\s*)?\b(\d{1,2})\s*([ab])?\b/i.exec(text ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 13) return null;
  return n + (m[2]?.toLowerCase() === 'b' ? 0.5 : 0);
}

export function propertyZone(location: PlanRequest['location'], climate: string | null): number | null {
  const fromLocation = parseZoneNumber(location?.hardinessZone);
  if (fromLocation != null) return fromLocation;
  const m = /zone\s*(\d{1,2}\s*[ab]?)/i.exec(climate ?? '');
  return m ? parseZoneNumber(m[1]) : null;
}

const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/['‘’"“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Genus + species epithet ("Hydrangea paniculata 'Limelight'" → "hydrangea paniculata"). */
function species(botanical: string | null | undefined): string | null {
  if (!botanical) return null;
  const words = botanical
    .replace(/['‘’"“”][^'‘’"“”]*['‘’"“”]/g, ' ')
    .replace(/[×]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && w !== 'x' && /^[a-z-]+$/.test(w));
  return words.length >= 2 ? `${words[0]} ${words[1]}` : null;
}

/** The catalog plant a name / botanical name refers to (exact common name, else same species). */
export function findCatalogPlant(name: string, botanical: string | null, plants: readonly CatalogPlant[]): CatalogPlant | null {
  const n = normalizeName(name);
  const byName = plants.find((p) => normalizeName(p.name) === n);
  if (byName) return byName;
  const sp = species(botanical);
  if (!sp) return null;
  const sameSpecies = plants.filter((p) => species(p.botanical) === sp);
  if (!sameSpecies.length) return null;
  // Prefer the same cultivar when both name one.
  const cultivar = /['‘’"“”]([^'‘’"“”]+)['‘’"“”]/.exec(botanical ?? '')?.[1]?.toLowerCase();
  return (cultivar && sameSpecies.find((p) => (p.botanical ?? '').toLowerCase().includes(cultivar))) || sameSpecies[0];
}

const SUN_LABEL: Record<SunExposure, string> = { 'full-sun': 'full sun', 'part-sun': 'part sun', shade: 'shade' };

function zoneLabel(z: number): string {
  return Number.isInteger(z) ? `${z}a` : `${Math.floor(z)}b`;
}

/** Catalog-based verdict for one plant; null when nothing contradicts the AI's rating. */
export function catalogVerdict(plant: CatalogPlant, zone: number | null, sun: SunExposure | null): { rating: Rating; reason: string } | null {
  const range = plant.zoneMin != null && plant.zoneMax != null ? `zones ${plant.zoneMin}–${plant.zoneMax}` : null;
  if (zone != null && range) {
    const z = Math.floor(zone);
    if (plant.zoneMin != null && z < plant.zoneMin) {
      return { rating: 'poor', reason: `Mode's plant data: hardy in ${range}; winters in your zone ${zoneLabel(zone)} are too cold.` };
    }
    if (plant.zoneMax != null && z > plant.zoneMax) {
      const over = z - plant.zoneMax;
      return {
        rating: over >= 2 ? 'poor' : 'caution',
        reason: `Mode's plant data: suited to ${range}; zone ${zoneLabel(zone)} summers are ${over >= 2 ? 'too hot' : 'at the warm edge of its range'}.`,
      };
    }
  }
  if (sun && plant.sun.length && !plant.sun.includes(sun)) {
    return {
      rating: 'caution',
      reason: `Mode's plant data: prefers ${plant.sun.map((s) => SUN_LABEL[s]).join(' or ')}; the targeted area gets ${SUN_LABEL[sun]}.`,
    };
  }
  return null;
}

export interface FeasibilityContext {
  plants: readonly CatalogPlant[];
  zone: number | null;
  /** Sun of the targeted ground areas when they all agree, else null. */
  sun: SunExposure | null;
}

const worse = (a: Rating, b: Rating): Rating => (RANK[b] > RANK[a] ? b : a);

/** Plan plant notes, downgraded where the catalog contradicts them. */
export function crossCheckPlanPlants(notes: PlanResult['plants'], ctx: FeasibilityContext): PlanResult['plants'] {
  if (!ctx.plants.length) return notes;
  return notes.map((note) => {
    const match = findCatalogPlant(note.name, note.botanical, ctx.plants);
    const verdict = match ? catalogVerdict(match, ctx.zone, ctx.sun) : null;
    // Claude may know more (e.g. microclimate) when it rates a plant worse than the catalog does.
    if (!verdict || RANK[verdict.rating] < RANK[note.rating]) return note;
    return {
      ...note,
      rating: worse(note.rating, verdict.rating),
      notes: note.notes.includes(verdict.reason) ? note.notes : [...note.notes, verdict.reason],
    };
  });
}

/** Element options whose feasibility the catalog contradicts are downgraded the same way. */
export function crossCheckOptions(result: ElementOptionsResult, ctx: FeasibilityContext): ElementOptionsResult {
  if (!ctx.plants.length) return result;
  return {
    ...result,
    dimensions: result.dimensions.map((d) => ({
      ...d,
      options: d.options.map((o) => {
        if (!o.feasibility) return o;
        const botanical = /\b([A-Z][a-z]+ [a-z]+(?: ['‘][^'’]+['’])?)/.exec(`${o.description} ${o.promptText}`)?.[1] ?? null;
        const match = findCatalogPlant(o.label, botanical, ctx.plants);
        const verdict = match ? catalogVerdict(match, ctx.zone, ctx.sun) : null;
        if (!verdict || RANK[verdict.rating] < RANK[o.feasibility.rating]) return o;
        if (o.feasibility.reasons.includes(verdict.reason)) return o;
        return {
          ...o,
          feasibility: { rating: worse(o.feasibility.rating, verdict.rating), reasons: [...o.feasibility.reasons, verdict.reason] },
        };
      }),
    })),
  };
}

const GROUND_KINDS = new Set(['lawn', 'planting-bed', 'yard-border', 'tree', 'shrubs', 'walkway', 'driveway', 'patio', 'porch', 'steps', 'deck']);

/** The sun of the brief's targeted ground zones when they all agree. */
export function targetedSun(req: PlanRequest): SunExposure | null {
  const targets = new Set([...req.brief.targetZoneLabels, ...req.brief.elements.flatMap((e) => e.where)].map(normalizeName));
  const suns = new Set(
    req.zones.filter((z) => targets.has(normalizeName(z.label)) && GROUND_KINDS.has(z.kind) && z.sun).map((z) => z.sun as SunExposure),
  );
  return suns.size === 1 ? [...suns][0] : null;
}
