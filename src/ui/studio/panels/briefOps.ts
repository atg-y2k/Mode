/**
 * Pure operations on a photo's design brief (store.updateDraft recipes) and
 * summaries of briefs for display. Functions that take a brief / element
 * mutate it in place, so they work inside immer recipes and on plain objects
 * in tests.
 */
import {
  emptyBrief,
  type DesignBrief,
  type ElementDimension,
  type ElementOption,
  type ElementSpec,
  type ElementType,
  type IdeaItem,
  type PlantFeasibility,
  type Recommendation,
  type SceneMap,
} from '../../../../shared/types';
import { getElementDef } from '../../../assets/design';
import { elementDimensions, ideasForBrief } from '../planRequest';

/**
 * Stored in `brief.ideaItemIds` when the user deliberately excluded every
 * idea. An empty list means "use the active ideas" (see ideasForBrief), so
 * "none" needs a marker; it matches no item, so runs use no ideas.
 */
export const NO_IDEAS = '__none__';

export const PLANT_MATURITY_OPTIONS: { value: DesignBrief['plantMaturity']; label: string; hint: string }[] = [
  { value: 'new', label: 'Newly planted', hint: 'Nursery sizes, as installed — gaps between plants' },
  { value: 'established', label: 'Established', hint: 'About 3 years in — filled out, not yet full size' },
  { value: 'mature', label: 'Mature', hint: 'Full grown size — check it still fits the space' },
];

export function plantMaturityLabel(m: DesignBrief['plantMaturity']): string {
  return PLANT_MATURITY_OPTIONS.find((o) => o.value === m)?.label ?? 'Established';
}

/** Returns `list` with `id` added or removed. */
export function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function isBriefEmpty(brief: DesignBrief | undefined): boolean {
  return !brief || (!brief.prompt.trim() && brief.elements.length === 0);
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export function removeElement(brief: DesignBrief, elementId: string): void {
  brief.elements = brief.elements.filter((e) => e.id !== elementId);
}

export function moveElement(brief: DesignBrief, elementId: string, direction: -1 | 1): void {
  const i = brief.elements.findIndex((e) => e.id === elementId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= brief.elements.length) return;
  const [el] = brief.elements.splice(i, 1);
  brief.elements.splice(j, 0, el);
}

/**
 * Picks an option. Multi-choice dimensions toggle it; single-choice ones
 * replace the choice, and picking the chosen option again clears it ("no
 * preference", the planner decides).
 */
export function chooseOption(el: ElementSpec, dim: Pick<ElementDimension, 'id' | 'multiple'>, optionId: string): void {
  const cur = el.choices[dim.id] ?? [];
  if (dim.multiple) el.choices[dim.id] = toggled(cur, optionId);
  else el.choices[dim.id] = cur.length === 1 && cur[0] === optionId ? [] : [optionId];
}

export function isChosen(el: ElementSpec, dimensionId: string, optionId: string): boolean {
  return (el.choices[dimensionId] ?? []).includes(optionId);
}

/**
 * Replaces an element's dimensions (e.g. after "Tailor to my photo") and
 * keeps its choices valid: choices pointing at options that no longer exist
 * are dropped, dimensions the user already answered keep their answer (even
 * an empty one), new dimensions start at their default option.
 */
export function replaceDimensions(el: ElementSpec, dims: ElementDimension[]): void {
  const next: Record<string, string[]> = {};
  for (const d of dims) {
    const valid = new Set(d.options.map((o) => o.id));
    if (Object.prototype.hasOwnProperty.call(el.choices, d.id)) {
      const kept = (el.choices[d.id] ?? []).filter((id) => valid.has(id));
      next[d.id] = d.multiple ? kept : kept.slice(0, 1);
    } else {
      next[d.id] = d.defaultOptionId && valid.has(d.defaultOptionId) ? [d.defaultOptionId] : [];
    }
  }
  el.dimensions = dims;
  el.choices = next;
}

/** Clears every choice (the free-text prompt then drives the element). */
export function clearChoices(el: ElementSpec): void {
  for (const d of el.dimensions) el.choices[d.id] = [];
}

export function toggleElementZone(el: ElementSpec, zoneId: string): void {
  el.zoneIds = toggled(el.zoneIds, zoneId);
}

export function toggleElementPath(el: ElementSpec, pathId: string): void {
  el.pathIds = toggled(el.pathIds, pathId);
}

export function toggleTargetZone(brief: DesignBrief, zoneId: string): void {
  brief.targetZoneIds = toggled(brief.targetZoneIds, zoneId);
}

/** Removes a zone / path id everywhere in the brief (the zone or path was deleted). */
export function forgetSceneIds(brief: DesignBrief, ids: { zoneIds?: readonly string[]; pathIds?: readonly string[] }): void {
  const zones = new Set(ids.zoneIds ?? []);
  const paths = new Set(ids.pathIds ?? []);
  if (zones.size) {
    brief.targetZoneIds = brief.targetZoneIds.filter((id) => !zones.has(id));
    for (const el of brief.elements) el.zoneIds = el.zoneIds.filter((id) => !zones.has(id));
  }
  if (paths.size) for (const el of brief.elements) el.pathIds = el.pathIds.filter((id) => !paths.has(id));
}

/** Options to compare by default: the chosen ones first, then the rest ("none" options last), up to `max`. */
export function defaultCompareSelection(el: ElementSpec, dim: ElementDimension, max = 4): string[] {
  const chosen = new Set(el.choices[dim.id] ?? []);
  const isNone = (o: ElementOption) => o.visual?.kind === 'diagram' && o.visual.diagram === 'none';
  const ordered = [
    ...dim.options.filter((o) => chosen.has(o.id)),
    ...dim.options.filter((o) => !chosen.has(o.id) && !isNone(o)),
    ...dim.options.filter((o) => !chosen.has(o.id) && isNone(o)),
  ];
  return ordered.slice(0, Math.max(2, Math.min(max, 6))).map((o) => o.id);
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?;,\s]+$/g, '').trim();
}

/** Adds a line to the prompt unless it is already there. Returns true when it changed. */
export function appendToPrompt(brief: DesignBrief, text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  const existing = brief.prompt.split('\n').map(normalizeText);
  if (existing.includes(normalizeText(line)) || normalizeText(brief.prompt).includes(normalizeText(line))) return false;
  brief.prompt = brief.prompt.trim() ? `${brief.prompt.replace(/\s+$/, '')}\n${line}` : line;
  return true;
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

/** Idea ids a run of this brief would use (explicit picks, else the active ideas for the space). */
export function includedIdeaIds(board: readonly IdeaItem[], brief: DesignBrief, spaceId: string | null): string[] {
  return ideasForBrief(board, brief, spaceId).map((i) => i.id);
}

/** True when the brief uses its own pick of ideas rather than the active ones. */
export function hasCustomIdeas(brief: DesignBrief): boolean {
  return brief.ideaItemIds.length > 0;
}

/**
 * Includes / excludes one idea. The first toggle turns the implicit set (the
 * active ideas) into an explicit pick; excluding the last one stores NO_IDEAS.
 */
export function toggleIdea(brief: DesignBrief, board: readonly IdeaItem[], spaceId: string | null, ideaId: string): void {
  const current = includedIdeaIds(board, brief, spaceId);
  const next = toggled(current, ideaId);
  brief.ideaItemIds = next.length > 0 ? next : [NO_IDEAS];
}

/** Back to "use the active ideas". */
export function resetIdeas(brief: DesignBrief): void {
  brief.ideaItemIds = [];
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

/** An element for a recommendation: no option preselected (the prompt drives it), on the recommended zones. */
function recommendationElement(rec: Recommendation, makeElement: (type: ElementType) => ElementSpec): ElementSpec | null {
  if (!rec.elementType) return null;
  const el = makeElement(rec.elementType);
  clearChoices(el);
  if (rec.targetZoneIds.length > 0) el.zoneIds = [...rec.targetZoneIds];
  return el;
}

/**
 * Adds a recommendation to the brief: its prompt (once), its target zones and
 * its element (merged into an existing element of the same type when there
 * is one). Returns what changed.
 */
export function mergeRecommendation(
  brief: DesignBrief,
  rec: Recommendation,
  makeElement: (type: ElementType) => ElementSpec,
): { promptAdded: boolean; elementId: string | null; elementAdded: boolean } {
  const promptAdded = appendToPrompt(brief, rec.prompt);
  for (const id of rec.targetZoneIds) if (!brief.targetZoneIds.includes(id)) brief.targetZoneIds.push(id);
  if (!rec.elementType) return { promptAdded, elementId: null, elementAdded: false };
  const existing = brief.elements.find((e) => e.type === rec.elementType);
  if (existing) {
    for (const id of rec.targetZoneIds) if (!existing.zoneIds.includes(id)) existing.zoneIds.push(id);
    return { promptAdded, elementId: existing.id, elementAdded: false };
  }
  const el = recommendationElement(rec, makeElement);
  if (!el) return { promptAdded, elementId: null, elementAdded: false };
  brief.elements.push(el);
  return { promptAdded, elementId: el.id, elementAdded: true };
}

/** A brief that generates exactly this recommendation (keeping the user's plant maturity and idea picks). */
export function briefFromRecommendation(
  rec: Recommendation,
  base: DesignBrief | undefined,
  makeElement: (type: ElementType) => ElementSpec,
): DesignBrief {
  const brief = emptyBrief();
  brief.prompt = rec.prompt.trim();
  brief.targetZoneIds = [...new Set(rec.targetZoneIds)];
  brief.scope = 'zones';
  if (base) {
    brief.plantMaturity = base.plantMaturity;
    brief.ideaItemIds = [...base.ideaItemIds];
  }
  const el = recommendationElement(rec, makeElement);
  if (el) brief.elements.push(el);
  return brief;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

const RATING_RANK: Record<PlantFeasibility['rating'], number> = { good: 0, caution: 1, poor: 2 };

/** Worst plant rating among the chosen options (undefined when none are rated). */
export function worstChosenFeasibility(el: ElementSpec, dims: readonly ElementDimension[]): PlantFeasibility['rating'] | undefined {
  let worst: PlantFeasibility['rating'] | undefined;
  for (const d of dims) {
    for (const o of d.options) {
      if (!o.feasibility || !isChosen(el, d.id, o.id)) continue;
      if (!worst || RATING_RANK[o.feasibility.rating] > RATING_RANK[worst]) worst = o.feasibility.rating;
    }
  }
  return worst;
}

/** Labels of the chosen options, in dimension order. */
export function choiceLabels(el: ElementSpec): string[] {
  const out: string[] = [];
  for (const d of elementDimensions(el, { getElementDef })) {
    const ids = new Set(el.choices[d.id] ?? []);
    for (const o of d.options) if (ids.has(o.id)) out.push(o.label);
  }
  return out;
}

export interface BriefSummary {
  prompt: string;
  elements: { id: string; label: string; choices: string[]; where: string[]; note: string }[];
  areas: string[];
  scope: string;
  maturity: string;
}

/** Display summary of a brief (History, run details). Zone / path ids resolve to labels; missing ones are skipped. */
export function summarizeBrief(brief: DesignBrief, scene: SceneMap | undefined): BriefSummary {
  const zoneLabel = new Map((scene?.zones ?? []).map((z) => [z.id, z.label]));
  const pathLabel = new Map((scene?.paths ?? []).map((p) => [p.id, p.label]));
  const labelsOf = (ids: readonly string[], map: Map<string, string>) => ids.map((id) => map.get(id)).filter((l): l is string => !!l);
  return {
    prompt: brief.prompt.trim(),
    elements: brief.elements.map((el) => ({
      id: el.id,
      label: el.label,
      choices: choiceLabels(el),
      where: [...labelsOf(el.zoneIds, zoneLabel), ...labelsOf(el.pathIds, pathLabel)],
      note: el.note.trim(),
    })),
    areas: labelsOf(brief.targetZoneIds, zoneLabel),
    scope: brief.scope === 'whole' ? 'Whole image may change' : 'Only the selected areas change',
    maturity: plantMaturityLabel(brief.plantMaturity),
  };
}
