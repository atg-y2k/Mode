/**
 * Working with element specs in a brief: creating them from the built-in
 * definitions, merging AI-tailored dimensions, and annotating plant options
 * with feasibility for the property and spot.
 */
import type { ElementDimensionDraft, OptionVisualDraft } from '../../../shared/api';
import { newId } from '../../../shared/ids';
import {
  CONTEXT_ZONE_KINDS,
  type ElementDef,
  type ElementDimension,
  type ElementOption,
  type ElementSpec,
  type ElementType,
  type OptionVisual,
  type PlantFeasibility,
  type ProjectLocation,
  type SceneMap,
  type SceneZone,
  type SunExposure,
} from '../../../shared/types';
import { ELEMENT_DEFS, optionPlants } from './elements';
import { paletteFeasibility, type FeasibilityContext } from './feasibility';
import { PLANT_PROFILES } from './plants';
import { visualFromDraft } from './visuals';

const DEF_BY_TYPE = new Map<ElementType, ElementDef>(ELEMENT_DEFS.map((d) => [d.type, d]));

export function getElementDef(type: ElementType): ElementDef {
  // Unknown types (e.g. from an older save) fall back to the free-form element.
  return DEF_BY_TYPE.get(type) ?? (DEF_BY_TYPE.get('custom') as ElementDef);
}

/** Deep copy so specs never share option objects with the built-in definitions. */
export function cloneDimensions(dims: readonly ElementDimension[]): ElementDimension[] {
  return structuredClone(dims as ElementDimension[]);
}

/** "7a" → 7, "10b" → 10, " 6 " → 6; anything else → undefined. */
export function parseHardinessZone(zone: string | null | undefined): number | undefined {
  if (typeof zone !== 'string') return undefined;
  const m = /^\s*(?:zone\s*)?(\d{1,2})\s*([ab])?\s*$/i.exec(zone);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 13 ? n : undefined;
}

/**
 * Most common sun exposure among zones that have one; mixed exposures with
 * no clear majority read as part sun.
 */
export function dominantSun(zones: readonly Pick<SceneZone, 'sun'>[]): SunExposure | undefined {
  const counts = new Map<SunExposure, number>();
  for (const z of zones) if (z.sun) counts.set(z.sun, (counts.get(z.sun) ?? 0) + 1);
  if (counts.size === 0) return undefined;
  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, n]) => n === max).map(([s]) => s);
  return top.length === 1 ? top[0] : 'part-sun';
}

/** Reads deer pressure from climate-profile notes: true / false when stated, undefined when not mentioned. */
export function deerPressureFromNotes(notes: readonly string[] | undefined): boolean | undefined {
  if (!notes || notes.length === 0) return undefined;
  const text = notes.join(' ').toLowerCase();
  if (!text.includes('deer')) return undefined;
  if (/\b(no|low|little|minimal|rare|few)\b[^.;]{0,20}\bdeer\b|\bdeer\b[^.;]{0,20}\b(rare|uncommon|not (a )?(problem|common|an issue))\b/.test(text)) return false;
  return true;
}

/**
 * Feasibility context for a spot from the project's location / climate
 * profile and the targeted scene zones (their estimated sun).
 */
export function feasibilityContext(
  location: ProjectLocation | undefined,
  zones: readonly Pick<SceneZone, 'sun'>[] = [],
  setting: 'exterior' | 'interior' = 'exterior',
): FeasibilityContext {
  const label = location?.climate?.hardinessZone ?? location?.hardinessZone;
  const ctx: FeasibilityContext = { setting };
  const zone = parseHardinessZone(label);
  if (zone !== undefined) {
    ctx.zone = zone;
    ctx.zoneLabel = (label as string).trim();
  }
  const sun = dominantSun(zones);
  if (sun) ctx.sun = sun;
  const rain = location?.climate?.annualRainfallIn;
  if (typeof rain === 'number' && Number.isFinite(rain)) ctx.annualRainfallIn = rain;
  const deer = deerPressureFromNotes(location?.climate?.notes);
  if (deer !== undefined) ctx.deerPressure = deer;
  return ctx;
}

/** Feasibility of one built-in plant option (undefined for options that imply no plants). */
export function optionFeasibility(type: ElementType, dimensionId: string, optionId: string, ctx: FeasibilityContext): PlantFeasibility | undefined {
  const entry = optionPlants(type, dimensionId, optionId);
  if (!entry) return undefined;
  return paletteFeasibility(entry.plants.map((id) => PLANT_PROFILES[id]), entry.mode, ctx);
}

/**
 * Copies of the dimensions with `feasibility` set on every built-in plant
 * option for this context. AI options keep the feasibility the AI gave them.
 */
export function withPlantFeasibility(type: ElementType, dims: readonly ElementDimension[], ctx: FeasibilityContext): ElementDimension[] {
  return dims.map((dim) => ({
    ...dim,
    options: dim.options.map((o) => {
      const f = optionFeasibility(type, dim.id, o.id, ctx);
      return f ? { ...o, feasibility: f } : { ...o };
    }),
  }));
}

const RATING_RANK: Record<PlantFeasibility['rating'], number> = { good: 0, caution: 1, poor: 2 };

/** First option with the best feasibility rating, among options that have one. */
function bestFeasibleOption(dim: ElementDimension): ElementOption | undefined {
  let best: ElementOption | undefined;
  for (const o of dim.options) {
    if (!o.feasibility) continue;
    if (!best || RATING_RANK[o.feasibility.rating] < RATING_RANK[(best.feasibility as PlantFeasibility).rating]) best = o;
  }
  return best;
}

/**
 * Default choice for a dimension. With a known hardiness zone, plant
 * dimensions avoid a default the property cannot support (switching to the
 * best-rated option), and single-choice plant dimensions without a default
 * (e.g. lawn grass type) preselect the best-suited option.
 */
function defaultChoice(dim: ElementDimension, zoneKnown: boolean): string[] {
  const def = dim.defaultOptionId ? dim.options.find((o) => o.id === dim.defaultOptionId) : undefined;
  if (!zoneKnown) return def ? [def.id] : [];
  const best = bestFeasibleOption(dim);
  if (def) {
    if (def.feasibility?.rating === 'poor' && best && RATING_RANK[best.feasibility!.rating] < RATING_RANK.poor) return [best.id];
    return [def.id];
  }
  if (!dim.multiple && best && best.feasibility!.rating !== 'poor') return [best.id];
  return [];
}

/**
 * A new ElementSpec for the brief: default label, deep copy of the built-in
 * dimensions, default choices, and zoneIds preselected from the scene by the
 * element's zoneKinds (editable zones only). A Pathway also preselects the
 * scene's paths (existing / sketched ones, else suggested ones).
 *
 * With `ctx` (e.g. from feasibilityContext), plant options are annotated with
 * feasibility — using the preselected zones' sun when ctx.sun is not given —
 * and plant defaults steer away from options that cannot thrive there.
 */
export function newElementSpec(type: ElementType, scene?: SceneMap, ctx?: FeasibilityContext): ElementSpec {
  const def = getElementDef(type);
  const zones = scene
    ? scene.zones.filter((z) => z.editable && !CONTEXT_ZONE_KINDS.includes(z.kind) && def.zoneKinds.includes(z.kind))
    : [];
  let pathIds: string[] = [];
  if (scene && type === 'pathway') {
    const real = scene.paths.filter((p) => p.kind !== 'suggested');
    pathIds = (real.length > 0 ? real : scene.paths).map((p) => p.id);
  }

  let dimensions = cloneDimensions(def.dimensions);
  if (ctx) {
    const setting = ctx.setting ?? (def.setting === 'interior' ? 'interior' : 'exterior');
    const sun = ctx.sun ?? dominantSun(zones);
    dimensions = withPlantFeasibility(type, dimensions, { ...ctx, setting, ...(sun ? { sun } : {}) });
  }
  const zoneKnown = ctx?.zone !== undefined;
  const choices: Record<string, string[]> = {};
  for (const dim of dimensions) choices[dim.id] = defaultChoice(dim, zoneKnown);

  return { id: newId('el'), type: def.type, label: def.label, zoneIds: zones.map((z) => z.id), pathIds, dimensions, choices, note: '' };
}

// ---------------------------------------------------------------------------
// AI-tailored dimensions
// ---------------------------------------------------------------------------

/** Converts an AI option visual into an OptionVisual (texture spec with sensible unit sizes / seed). */
export function optionVisualFromDraft(v: OptionVisualDraft): OptionVisual | undefined {
  return visualFromDraft(v);
}

function slugify(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function labelKey(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

type DraftOption = ElementDimensionDraft['options'][number];

function isDraftVisual(v: unknown): v is OptionVisualDraft {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return 'pattern' in o || 'unitWidthIn' in o || o.kind === 'none' || (o.kind === 'color' && Array.isArray(o.colors));
}

/** Normalizes an AI draft option or an already-converted option. */
function toOption(o: DraftOption | ElementOption): ElementOption | undefined {
  const label = o.label?.trim();
  if (!label) return undefined;
  const out: ElementOption = {
    id: slugify(o.id) || slugify(label) || 'option',
    label,
    description: o.description?.trim() ?? '',
    promptText: o.promptText?.trim() || label,
  };
  const visual = isDraftVisual(o.visual) ? visualFromDraft(o.visual) : (o.visual as OptionVisual | undefined);
  if (visual) out.visual = structuredClone(visual);
  if (o.rationale?.trim()) out.rationale = o.rationale.trim();
  if (o.feasibility) out.feasibility = { rating: o.feasibility.rating, reasons: [...o.feasibility.reasons] };
  return out;
}

/** AI options first (deduped by label); an AI option with a built-in's label takes over that built-in's id (choices stay valid). */
function mergeOptions(ai: ElementOption[], builtin: ElementOption[]): ElementOption[] {
  const builtinByLabel = new Map(builtin.map((o) => [labelKey(o.label), o]));
  const builtinIds = new Set(builtin.map((o) => o.id));
  const usedIds = new Set<string>();
  const usedLabels = new Set<string>();
  const out: ElementOption[] = [];
  for (const o of ai) {
    const key = labelKey(o.label);
    if (usedLabels.has(key)) continue;
    const twin = builtinByLabel.get(key);
    const id = twin ? twin.id : uniqueId(o.id, new Set([...builtinIds, ...usedIds]));
    const merged: ElementOption = { ...o, id };
    if (twin) {
      if (!merged.visual && twin.visual) merged.visual = structuredClone(twin.visual);
      if (!merged.rationale && twin.rationale) merged.rationale = twin.rationale;
      if (!merged.feasibility && twin.feasibility) merged.feasibility = structuredClone(twin.feasibility);
    }
    out.push(merged);
    usedIds.add(id);
    usedLabels.add(key);
  }
  for (const o of builtin) {
    const key = labelKey(o.label);
    if (usedIds.has(o.id) || usedLabels.has(key)) continue;
    out.push(structuredClone(o));
    usedIds.add(o.id);
    usedLabels.add(key);
  }
  return out;
}

/**
 * Built-in dimensions refined by AI drafts: same ids merged (AI options
 * first, deduped by label), new ids appended. Dimension ids are matched after
 * kebab-casing (and by label as a fallback); AI options that duplicate a
 * built-in option's label keep the built-in id so existing choices stay
 * valid. Also accepts already-converted ElementDimensions. Inputs are not mutated.
 */
export function mergeDimensions(
  builtin: ElementDimension[],
  drafts: ReadonlyArray<ElementDimensionDraft | ElementDimension>,
): ElementDimension[] {
  const out = cloneDimensions(builtin);
  const seen = new Set<string>();
  for (const draft of drafts) {
    const id = slugify(draft.id) || slugify(draft.label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const options: ElementOption[] = [];
    const optionIds = new Set<string>();
    for (const raw of draft.options ?? []) {
      const o = toOption(raw);
      if (!o) continue;
      o.id = uniqueId(o.id, optionIds);
      optionIds.add(o.id);
      options.push(o);
    }
    if (options.length === 0) continue;

    const target = out.find((d) => d.id === id) ?? out.find((d) => labelKey(d.label) === labelKey(draft.label));
    if (target) {
      target.options = mergeOptions(options, target.options);
      if (draft.question?.trim()) target.question = draft.question.trim();
      if (!target.multiple && draft.multiple) target.multiple = true;
      if (target.defaultOptionId && !target.options.some((o) => o.id === target.defaultOptionId)) delete target.defaultOptionId;
      continue;
    }
    const dim: ElementDimension = {
      id: uniqueId(id, new Set(out.map((d) => d.id))),
      label: draft.label?.trim() || id,
      question: draft.question?.trim() || draft.label?.trim() || id,
      options,
    };
    if (draft.multiple) dim.multiple = true;
    out.push(dim);
  }
  return out;
}

/**
 * A shared swatch span (inches) for a dimension whose options are textures of
 * very different scales (e.g. Pathway → stone size), so `textureSwatch(spec,
 * size, span)` shows the sizes at true relative scale. Undefined when the
 * options are of similar scale (use the per-texture default).
 */
export function swatchSpanIn(dim: ElementDimension): number | undefined {
  const scales = dim.options
    .map((o) => (o.visual?.kind === 'texture' ? Math.sqrt(o.visual.texture.unitWidthIn * o.visual.texture.unitHeightIn) : undefined))
    .filter((s): s is number => s !== undefined && Number.isFinite(s) && s > 0);
  if (scales.length < 2) return undefined;
  const max = Math.max(...scales);
  const min = Math.min(...scales);
  if (max / min < 1.8) return undefined;
  return Math.round(Math.min(144, Math.max(18, max * 2.5)));
}
