/**
 * Cleans Claude's structured outputs before they reach the client: geometry
 * clamped and simplified, enum-dependent fields made consistent, ids made
 * kebab-case and unique, references limited to what the request listed, and
 * compare plans aligned one-to-one with the compared options.
 */
import type {
  ClimateResult,
  DescribeIdeaResult,
  ElementOptionsResult,
  PlanRequest,
  PlanResult,
  RecommendResult,
  SceneResult,
} from '../../shared/api';
import { CONTEXT_ZONE_KINDS, type ZoneKind } from '../../shared/types';
import { templatePlan } from './prompts';
import { clamp, normalizeHex, slugify, truncateText } from './util';

type NormPoint = { x: number; y: number };

/** Ground / planting zones where sun exposure is meaningful. */
const SUN_ZONE_KINDS: ReadonlySet<ZoneKind> = new Set<ZoneKind>([
  'walkway',
  'driveway',
  'sidewalk',
  'lawn',
  'planting-bed',
  'yard-border',
  'tree',
  'shrubs',
  'fence',
  'retaining-wall',
  'patio',
  'deck',
  'pool',
  'porch',
  'steps',
]);

const MAX_ZONE_POINTS = 24;
const MAX_PATH_POINTS = 12;
/** Max characters of a variation brief (RenderVariationRequestSchema allows 8000; leave room for framing). */
export const MAX_VARIATION_BRIEF = 7000;

function finite(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Clamps to 0..1, drops non-finite points and consecutive near-duplicates. */
export function cleanPoints(points: readonly NormPoint[], minGap = 0.002): NormPoint[] {
  const out: NormPoint[] = [];
  for (const p of points) {
    if (!finite(p.x) || !finite(p.y)) continue;
    const q = { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - q.x) < minGap && Math.abs(last.y - q.y) < minGap) continue;
    out.push(q);
  }
  return out;
}

/** Shoelace area; positive = clockwise on screen (y grows downward). */
export function signedArea(points: readonly NormPoint[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Keeps at most `max` points, evenly spaced along the list (first point kept). */
function decimate<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor((i * points.length) / max)]);
  return out;
}

/** Valid clockwise polygon (3–24 points, non-degenerate) or null. */
export function cleanPolygon(points: readonly NormPoint[]): NormPoint[] | null {
  let poly = cleanPoints(points);
  if (poly.length > 1) {
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (Math.abs(first.x - last.x) < 0.002 && Math.abs(first.y - last.y) < 0.002) poly = poly.slice(0, -1);
  }
  poly = decimate(poly, MAX_ZONE_POINTS);
  if (poly.length < 3) return null;
  const area = signedArea(poly);
  if (Math.abs(area) < 0.00005) return null;
  return area < 0 ? poly.reverse() : poly;
}

function uniqueLabel(label: string, used: Map<string, number>): string {
  const base = label.trim() || 'Area';
  const key = base.toLowerCase();
  const n = (used.get(key) ?? 0) + 1;
  used.set(key, n);
  return n === 1 ? base : `${base} (${n})`;
}

export function cleanSceneResult(result: SceneResult, styleIds: ReadonlySet<string> | null): SceneResult {
  const labels = new Map<string, number>();
  const zones: SceneResult['zones'] = [];
  for (const z of result.zones) {
    const polygon = cleanPolygon(z.polygon);
    if (!polygon) continue;
    const context = CONTEXT_ZONE_KINDS.includes(z.kind);
    zones.push({
      ...z,
      label: uniqueLabel(z.label, labels),
      description: z.description.trim(),
      polygon,
      editable: context ? false : z.editable,
      sun: SUN_ZONE_KINDS.has(z.kind) ? z.sun : null,
    });
  }

  const paths: SceneResult['paths'] = [];
  for (const p of result.paths) {
    const points = decimate(cleanPoints(p.points), MAX_PATH_POINTS);
    if (points.length < 2) continue;
    paths.push({
      ...p,
      points,
      widthFraction: finite(p.widthFraction) ? clamp(p.widthFraction, 0.003, 0.6) : 0.05,
    });
  }

  const styleId = result.architecture.styleId?.trim() || null;
  return {
    ...result,
    architecture: {
      ...result.architecture,
      styleId: styleId && (!styleIds || styleIds.has(styleId)) ? styleId : null,
    },
    zones,
    paths,
    keep: result.keep.map((s) => s.trim()).filter(Boolean),
    opportunities: result.opportunities.map((s) => s.trim()).filter(Boolean),
  };
}

/** "Zone 7A" / "7 a" / "USDA 7a" → "7a"; other text is kept trimmed. */
export function normalizeZone(zone: string): string {
  const m = /(\d{1,2})\s*([ab])?\b/i.exec(zone);
  if (!m) return zone.trim();
  const n = Number(m[1]);
  if (n < 1 || n > 13) return zone.trim();
  return `${n}${m[2]?.toLowerCase() ?? ''}`;
}

export function cleanClimate(result: ClimateResult): ClimateResult {
  return {
    ...result,
    hardinessZone: normalizeZone(result.hardinessZone),
    annualRainfallIn:
      result.annualRainfallIn != null && finite(result.annualRainfallIn) && result.annualRainfallIn > 0 && result.annualRainfallIn < 400
        ? Math.round(result.annualRainfallIn * 10) / 10
        : null,
    notes: result.notes.map((n) => n.trim()).filter(Boolean),
  };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
}

function sizeOrNull(n: number | null): number | null {
  return n != null && finite(n) && n > 0.05 && n <= 600 ? n : null;
}

export function cleanElementOptions(result: ElementOptionsResult): ElementOptionsResult {
  const dimIds = new Set<string>();
  const dimensions: ElementOptionsResult['dimensions'] = [];
  for (const d of result.dimensions.slice(0, 6)) {
    const optionIds = new Set<string>();
    const options: ElementOptionsResult['dimensions'][number]['options'] = [];
    for (const o of d.options.slice(0, 8)) {
      const label = o.label.trim();
      if (!label || !o.promptText.trim()) continue;
      const colors = o.visual.colors.map(normalizeHex).filter((c): c is string => c != null).slice(0, 4);
      let kind = o.visual.kind;
      if (kind === 'texture' && !o.visual.pattern) kind = colors.length ? 'color' : 'none';
      if (kind === 'color' && !colors.length) kind = 'none';
      options.push({
        ...o,
        id: uniqueId(slugify(o.id || label, 'option'), optionIds),
        label,
        description: o.description.trim(),
        promptText: o.promptText.trim(),
        rationale: o.rationale.trim(),
        visual: {
          kind,
          pattern: kind === 'texture' ? o.visual.pattern : null,
          colors: kind === 'none' ? [] : colors,
          unitWidthIn: kind === 'texture' ? sizeOrNull(o.visual.unitWidthIn) : null,
          unitHeightIn: kind === 'texture' ? sizeOrNull(o.visual.unitHeightIn) : null,
        },
      });
    }
    if (!options.length) continue;
    dimensions.push({ ...d, id: uniqueId(slugify(d.id || d.label, 'choice'), dimIds), label: d.label.trim(), question: d.question.trim(), options });
  }
  return { dimensions, tips: result.tips.map((t) => t.trim()).filter(Boolean).slice(0, 6) };
}

export function cleanRecommendations(result: RecommendResult, zoneIds: ReadonlySet<string>): RecommendResult {
  return {
    recommendations: result.recommendations
      .filter((r) => r.title.trim() && r.prompt.trim())
      .slice(0, 10)
      .map((r) => ({
        ...r,
        title: r.title.trim(),
        prompt: r.prompt.trim(),
        why: r.why.trim(),
        targetZoneIds: [...new Set(r.targetZoneIds.filter((id) => zoneIds.has(id)))],
      })),
  };
}

export function cleanDescribeIdea(result: DescribeIdeaResult): DescribeIdeaResult {
  const tags = [...new Set(result.styleTags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
  return { title: result.title.trim() || 'Inspiration', description: result.description.trim(), styleTags: tags };
}

/** Plans may ask for 1–8 variations. */
export function variationCount(req: PlanRequest): number {
  if (req.compare) return req.compare.options.length;
  return clamp(Math.round(finite(req.count) ? req.count : 1), 1, 8);
}

const normalizeForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Final plan: briefs trimmed to the render limit, titles present, and for
 * compare runs exactly one variation per option in the request's order with
 * `optionId` passed through. An option Claude skipped is filled by swapping
 * the option wording into a sibling brief, or from the template plan.
 */
export function finalizePlan(result: PlanResult, req: PlanRequest): PlanResult {
  const count = variationCount(req);
  const plants = result.plants
    .filter((p) => p.name.trim())
    .map((p) => ({ ...p, name: p.name.trim(), notes: p.notes.map((n) => n.trim()).filter(Boolean) }));
  const cleaned = result.variations
    .filter((v) => v.brief.trim())
    .map((v) => ({ title: v.title.trim(), brief: truncateText(v.brief, MAX_VARIATION_BRIEF), optionId: v.optionId }));

  if (!req.compare) {
    return {
      plan: result.plan.trim(),
      plants,
      variations: cleaned.slice(0, count).map((v, i) => ({ ...v, title: v.title || `Variation ${i + 1}`, optionId: null })),
    };
  }

  const options = req.compare.options;
  const remaining = [...cleaned];
  const take = (pred: (v: (typeof cleaned)[number]) => boolean) => {
    const i = remaining.findIndex(pred);
    return i >= 0 ? remaining.splice(i, 1)[0] : undefined;
  };
  // 1) exact optionId, 2) the title names the option, 3) leftovers in order.
  const matched = options.map((o) => take((v) => v.optionId === o.id));
  options.forEach((o, i) => {
    matched[i] ??= take((v) => normalizeForMatch(v.title) === normalizeForMatch(o.label));
  });
  options.forEach((_o, i) => {
    matched[i] ??= take((v) => v.optionId == null || !options.some((x) => x.id === v.optionId));
  });

  const template = templatePlan(req, count);
  const variations = options.map((o, i) => {
    const found = matched[i];
    if (found) return { title: found.title || o.label, brief: found.brief, optionId: o.id };
    // Swap this option's wording into a sibling's brief when the sibling quotes its own option verbatim.
    for (let j = 0; j < options.length; j++) {
      const sibling = matched[j];
      if (!sibling) continue;
      const theirs = options[j].promptText.trim();
      if (theirs && sibling.brief.includes(theirs)) {
        return { title: o.label, brief: truncateText(sibling.brief.split(theirs).join(o.promptText.trim()), MAX_VARIATION_BRIEF), optionId: o.id };
      }
    }
    return { title: o.label, brief: truncateText(template.variations[i].brief, MAX_VARIATION_BRIEF), optionId: o.id };
  });
  return { plan: result.plan.trim(), plants, variations };
}
