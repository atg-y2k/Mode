/**
 * Assembling the plan request (pure): the brief, scene, idea board, site and
 * climate become the text Claude plans variations from. Design knowledge and
 * plant feasibility are injected (PlanKnowledge) so the assembly is testable
 * without the knowledge base.
 *
 * Plant feasibility outdoors: every chosen (and every compared) plant option
 * is rated for the property's hardiness zone, climate and the sun of the
 * zones it goes in, and the rating rides along with the element so the plan
 * keeps plants that can thrive there (and explains the ones that can't).
 */
import type { PlanRequest } from '../../../shared/api';
import {
  INTERIOR_SPACE_TYPES,
  SPACE_TYPE_LABELS,
  type DesignBrief,
  type DesignTheme,
  type ElementDef,
  type ElementDimension,
  type ElementGuidance,
  type ElementOption,
  type ElementSpec,
  type ElementType,
  type IdeaItem,
  type PlantFeasibility,
  type ProjectLocation,
  type SceneMap,
  type ScenePath,
  type SceneZone,
} from '../../../shared/types';
import type { FeasibilityContext } from '../../assets/design';
import { climateSummaryText, locationForApi } from '../../lib/studio';
import { compassName } from '../../site/sun';
import { groundSunSpot } from './panels/zones';

const LIMITS = { sceneSummary: 8000, prompt: 4000, climate: 4000, idea: 600, note: 600 } as const;

const SUN_LABEL: Record<NonNullable<SceneZone['sun']>, string> = {
  'full-sun': 'full sun',
  'part-sun': 'part sun',
  shade: 'shade',
};

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const joinNonEmpty = (parts: (string | undefined | null | false)[], sep: string) => parts.filter((p): p is string => !!p && !!p.trim()).join(sep);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const FACING_SUBJECT: Partial<Record<SceneMap['category'], string>> = {
  'front-exterior': 'front',
  'front-yard': 'front',
  'back-exterior': 'back',
  backyard: 'back',
  'side-exterior': 'side',
  'side-yard': 'side',
};

const FACING_SOURCE: Record<NonNullable<SceneMap['facadeAzimuthSource']>, string> = {
  photo: "from the photo's compass heading",
  user: 'set by the homeowner',
  ai: 'estimated from the photo',
};

/**
 * "front faces south (180°), set by the homeowner" from scene.facadeAzimuthDeg
 * (degrees from north the photographed facade / view faces); '' when unknown.
 */
export function facingText(scene: Pick<SceneMap, 'category' | 'facadeAzimuthDeg' | 'facadeAzimuthSource'>): string {
  const raw = scene.facadeAzimuthDeg;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '';
  const deg = ((Math.round(raw) % 360) + 360) % 360;
  const interior = (INTERIOR_SPACE_TYPES as readonly string[]).includes(scene.category);
  const subject = FACING_SUBJECT[scene.category] ?? (interior ? 'photographed wall' : 'photographed side of the house');
  const source = scene.facadeAzimuthSource ? `, ${FACING_SOURCE[scene.facadeAzimuthSource]}` : '';
  return `${subject} faces ${compassName(deg)} (${deg}°)${source}`;
}

/** "~5 h direct sun" (rounded to the half hour); '' when unknown. */
function sunHoursText(hours: number | undefined): string {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return '';
  const h = Math.round(hours * 2) / 2;
  return `~${h} h direct sun`;
}

/** Compact description of a scene for prompts (summary, architecture, zones with sun, paths, keep-list). */
export function sceneSummaryText(scene: SceneMap): string {
  const a = scene.architecture;
  const category = SPACE_TYPE_LABELS[scene.category] ?? scene.category;
  const zoneLine = scene.zones
    .map((z) => {
      const hours = sunHoursText(z.sunHours);
      return `${z.label} (${z.kind}${z.sun ? `, ${SUN_LABEL[z.sun]}` : ''}${hours ? `, ${hours}` : ''}${z.editable ? '' : ', context'})`;
    })
    .join('; ');
  const facing = facingText(scene);
  const pathLine = scene.paths
    .map((p) => `${p.label}${p.kind === 'existing' ? '' : ` [${p.kind}]`}${p.description ? ` — ${clip(p.description, 160)}` : ''}`)
    .join('; ');
  // Most important first, so truncation drops the least useful lines.
  const lines = [
    `Photo: ${category}. ${scene.summary}`,
    scene.viewpoint && `Viewpoint: ${scene.viewpoint}`,
    `Architecture: ${a.style}${a.era ? ` (${a.era})` : ''}${scene.style && scene.style !== a.style ? `; current look: ${scene.style}` : ''}`,
    a.features.length > 0 && `Defining features: ${a.features.join('; ')}`,
    a.materials.length > 0 && `Existing materials: ${a.materials.join('; ')}`,
    a.proportions && `Proportions: ${a.proportions}`,
    a.designLanguage.length > 0 && `Design language to respect: ${a.designLanguage.join('; ')}`,
    a.purpose.length > 0 && `How the space is used: ${a.purpose.join('; ')}`,
    scene.boundaries && `Boundaries: ${scene.boundaries}`,
    joinNonEmpty([scene.lighting && `Light: ${scene.lighting}`, scene.orientation && `Orientation: ${scene.orientation}`, facing && `Facing: ${facing}`], '. '),
    zoneLine && `Zones: ${zoneLine}`,
    pathLine && `Paths: ${pathLine}`,
    scene.keep.length > 0 && `Keep: ${scene.keep.join('; ')}`,
    scene.opportunities.length > 0 && `Opportunities: ${scene.opportunities.join('; ')}`,
  ];
  let out = '';
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const next = out ? `${out}\n${line.trim()}` : line.trim();
    if (next.length > LIMITS.sceneSummary) break;
    out = next;
  }
  return out;
}

/** Description of a path for prompts; sketched paths say so (they carry no AI description). */
export function pathDescription(p: ScenePath): string {
  const route = p.from || p.to ? `${p.from || 'start'} → ${p.to || 'end'}` : '';
  const origin = p.kind === 'sketch' ? 'Drawn by the homeowner on the photo as the route of a new path' : p.kind === 'suggested' ? 'Suggested new route' : '';
  return joinNonEmpty([origin, route, p.description], '. ');
}

// ---------------------------------------------------------------------------
// Idea board
// ---------------------------------------------------------------------------

/**
 * Idea items a run draws on: the brief's explicit picks when it has any,
 * else the active items for this space (or the whole house).
 */
export function ideasForBrief(board: readonly IdeaItem[], brief: DesignBrief, spaceId: string | null): IdeaItem[] {
  if (brief.ideaItemIds.length > 0) {
    const byId = new Map(board.map((i) => [i.id, i]));
    return brief.ideaItemIds.map((id) => byId.get(id)).filter((i): i is IdeaItem => !!i);
  }
  return board.filter((i) => i.active && (i.spaceIds.length === 0 || (spaceId !== null && i.spaceIds.includes(spaceId))));
}

/** One line per idea item for the plan prompt. */
export function ideaText(item: IdeaItem, getTheme: (id: string) => DesignTheme | undefined): string {
  const note = item.note.trim();
  const colors = item.colors.length ? `Colors: ${item.colors.slice(0, 5).join(', ')}` : '';
  switch (item.kind) {
    case 'theme': {
      const theme = item.themeId ? getTheme(item.themeId) : undefined;
      const head = `Design theme "${theme?.name ?? item.title}"`;
      return clip(joinNonEmpty([head, theme?.promptHint, theme && `Purpose: ${theme.purpose}`, note && `Homeowner: ${note}`], '. '), LIMITS.idea);
    }
    case 'product': {
      const p = item.product;
      const seller = p ? ` from ${p.store}${p.brand ? ` (${p.brand})` : ''}` : '';
      return clip(
        joinNonEmpty(
          [`Product to use: ${item.title}${seller}`, p?.specs.length ? p.specs.join(', ') : '', item.aiDescription, note && `Homeowner: ${note}`],
          '. ',
        ),
        LIMITS.idea,
      );
    }
    case 'image':
      return clip(joinNonEmpty([`Inspiration image "${item.title}"`, item.aiDescription, note && `What they like: ${note}`, colors], '. '), LIMITS.idea);
    case 'note':
    default:
      return clip(joinNonEmpty([`Note "${item.title}"`, note, colors], '. '), LIMITS.idea);
  }
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export interface PlanKnowledge {
  getElementDef(type: ElementType): ElementDef;
  guidanceFor(type: ElementType): ElementGuidance | undefined;
  getTheme(id: string): DesignTheme | undefined;
  /** Feasibility of a built-in plant option for a context (undefined: the option implies no plants). */
  optionFeasibility(type: ElementType, dimensionId: string, optionId: string, ctx: FeasibilityContext): PlantFeasibility | undefined;
  feasibilityContext(location: ProjectLocation | undefined, zones: readonly Pick<SceneZone, 'sun'>[], setting: 'exterior' | 'interior'): FeasibilityContext;
}

/** The element's dimensions, plus built-in ones its choices refer to but the spec lacks. */
export function elementDimensions(el: ElementSpec, knowledge: Pick<PlanKnowledge, 'getElementDef'>): ElementDimension[] {
  const dims = [...el.dimensions];
  const have = new Set(dims.map((d) => d.id));
  const missing = Object.keys(el.choices).filter((id) => !have.has(id) && (el.choices[id]?.length ?? 0) > 0);
  if (missing.length > 0) {
    for (const d of knowledge.getElementDef(el.type).dimensions) if (missing.includes(d.id)) dims.push(d);
  }
  return dims;
}

/** Chosen options of a dimension, in the order the dimension lists them. */
export function chosenOptions(el: ElementSpec, dim: ElementDimension): ElementOption[] {
  const ids = new Set(el.choices[dim.id] ?? []);
  return dim.options.filter((o) => ids.has(o.id));
}

export interface RatedOption {
  dimension: ElementDimension;
  option: ElementOption;
  feasibility: PlantFeasibility;
}

/**
 * Feasibility of plant options for this element's spot: built-in options are
 * re-rated for the current context (zone, the sun of the element's zones,
 * climate); AI-tailored options keep the rating the AI gave them.
 */
export function rateOptions(
  el: ElementSpec,
  pairs: readonly { dimension: ElementDimension; option: ElementOption }[],
  ctx: FeasibilityContext,
  knowledge: Pick<PlanKnowledge, 'optionFeasibility'>,
): RatedOption[] {
  const out: RatedOption[] = [];
  for (const { dimension, option } of pairs) {
    const feasibility = knowledge.optionFeasibility(el.type, dimension.id, option.id, ctx) ?? option.feasibility;
    if (feasibility) out.push({ dimension, option, feasibility });
  }
  return out;
}

/**
 * Context for rating an element's plants: the property's climate plus the
 * sun of the zones it targets (else the brief's targets, else the ground
 * nearby — the lawn first — as the element card's header shows).
 */
export function elementFeasibilityContext(
  el: ElementSpec,
  scene: SceneMap | undefined,
  location: ProjectLocation | undefined,
  setting: 'exterior' | 'interior',
  knowledge: Pick<PlanKnowledge, 'feasibilityContext'>,
  fallbackZoneIds: readonly string[] = [],
): FeasibilityContext {
  const zones = scene?.zones ?? [];
  let spot = zones.filter((z) => el.zoneIds.includes(z.id) && z.sun);
  if (spot.length === 0) spot = zones.filter((z) => fallbackZoneIds.includes(z.id) && z.sun);
  if (spot.length === 0 && setting === 'exterior') spot = groundSunSpot(zones)?.zones ?? [];
  return knowledge.feasibilityContext(location, spot, setting);
}

function describeContext(ctx: FeasibilityContext): string {
  return joinNonEmpty(
    [ctx.zoneLabel ? `USDA ${ctx.zoneLabel}` : ctx.zone !== undefined ? `USDA ${ctx.zone}` : 'zone unknown', ctx.sun && SUN_LABEL[ctx.sun]],
    ', ',
  );
}

/** "Plant check for this spot (USDA 7a, part sun): Pollinator mix — caution: …". Empty when nothing is rated. */
export function plantCheckText(rated: readonly RatedOption[], ctx: FeasibilityContext): string {
  if (rated.length === 0) return '';
  const items = rated.map(({ option, feasibility }) => {
    const why = feasibility.reasons.slice(0, 2).join('; ');
    return `${option.label} — ${feasibility.rating}${why && feasibility.rating !== 'good' ? `: ${why}` : ''}`;
  });
  const anyIssue = rated.some((r) => r.feasibility.rating !== 'good');
  return `Plant check for this spot (${describeContext(ctx)}): ${items.join(' | ')}.${anyIssue ? ' Keep the look but favor plants that thrive here; flag the problem ones in plants.' : ''}`;
}

function guidanceText(types: readonly ElementType[], knowledge: Pick<PlanKnowledge, 'guidanceFor' | 'getElementDef'>): string {
  const lines: string[] = [];
  for (const type of [...new Set(types)]) {
    if (type === 'custom') continue;
    const g = knowledge.guidanceFor(type);
    if (!g) continue;
    const rules = g.rulesOfThumb
      .slice(0, 3)
      .map((r) => r.trim().replace(/[.;\s]+$/, ''))
      .join('; ');
    lines.push(`- ${knowledge.getElementDef(type).label}: ${g.purpose}${rules ? ` Rules of thumb: ${rules}.` : ''}`);
  }
  return lines.length ? `Design intent of the requested elements:\n${lines.join('\n')}` : '';
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export interface ResolvedCompare {
  element: ElementSpec;
  dimension: ElementDimension;
  options: ElementOption[];
}

/** Looks up the compared element / dimension / options in the brief (null when the element or dimension is gone). */
export function resolveCompare(
  brief: DesignBrief,
  compare: { elementId: string; dimensionId: string; optionIds: string[] },
  knowledge: Pick<PlanKnowledge, 'getElementDef'>,
): ResolvedCompare | null {
  const element = brief.elements.find((e) => e.id === compare.elementId);
  if (!element) return null;
  const dimension =
    element.dimensions.find((d) => d.id === compare.dimensionId) ?? knowledge.getElementDef(element.type).dimensions.find((d) => d.id === compare.dimensionId);
  if (!dimension) return null;
  const seen = new Set<string>();
  const options = compare.optionIds
    .filter((id) => !seen.has(id) && seen.add(id))
    .map((id) => dimension.options.find((o) => o.id === id))
    .filter((o): o is ElementOption => !!o)
    .slice(0, 6);
  return { element, dimension, options };
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface PlanInput {
  /** Data URL of the base image (original photo or the variation the run starts from). */
  image: string;
  /** Up to 3 downscaled idea-board images. */
  ideaImages: string[];
  scene: SceneMap | undefined;
  setting: 'exterior' | 'interior';
  /** e.g. "Front yard" — used when there is no scene map yet. */
  spaceLabel: string;
  brief: DesignBrief;
  ideas: readonly IdeaItem[];
  location: ProjectLocation | undefined;
  /** Variations for a 'variations' run (ignored for compare runs). */
  count: number;
  compare?: ResolvedCompare | null;
  refine?: { title: string; brief: string; feedback: string | null } | null;
}

/** Climate text for prompts: the climate profile, else at least the hardiness zone when known. */
export function climateText(location: ProjectLocation | undefined): string | null {
  const full = climateSummaryText(location);
  if (full) return clip(full, LIMITS.climate);
  const zone = location?.hardinessZone?.trim();
  return zone ? `USDA hardiness zone ${zone} (no detailed climate profile yet).` : null;
}

export function buildPlanRequest(input: PlanInput, knowledge: PlanKnowledge): PlanRequest {
  const { scene, brief, setting } = input;
  const zones = scene?.zones ?? [];
  const paths = scene?.paths ?? [];
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const pathById = new Map(paths.map((p) => [p.id, p]));
  const compare = input.compare ?? null;
  const exterior = setting === 'exterior';

  const elements = brief.elements.map((el) => {
    const isCompared = compare?.element.id === el.id;
    const dims = elementDimensions(el, knowledge);
    const choices: { dimension: string; options: string[] }[] = [];
    const chosenPairs: { dimension: ElementDimension; option: ElementOption }[] = [];
    for (const dim of dims) {
      if (isCompared && dim.id === compare.dimension.id) continue; // varies per variation
      const picked = chosenOptions(el, dim);
      if (picked.length === 0) continue;
      choices.push({ dimension: dim.label, options: picked.map((o) => o.promptText) });
      for (const option of picked) chosenPairs.push({ dimension: dim, option });
    }
    let plantCheck = '';
    if (exterior) {
      const ctx = elementFeasibilityContext(el, scene, input.location, setting, knowledge, brief.targetZoneIds);
      const pairs = isCompared ? [...chosenPairs, ...compare.options.map((option) => ({ dimension: compare.dimension, option }))] : chosenPairs;
      plantCheck = plantCheckText(rateOptions(el, pairs, ctx, knowledge), ctx);
    }
    const where = [...el.zoneIds.map((id) => zoneById.get(id)?.label), ...el.pathIds.map((id) => pathById.get(id)?.label)].filter((l): l is string => !!l);
    return {
      type: el.type,
      label: el.label.trim() || knowledge.getElementDef(el.type).label,
      where,
      choices,
      note: joinNonEmpty([clip(el.note, LIMITS.note), plantCheck], ' '),
    };
  });

  const baseSummary = scene ? sceneSummaryText(scene) : `No scene map yet. The photo shows: ${input.spaceLabel}.`;
  const guidance = guidanceText(
    brief.elements.map((e) => e.type),
    knowledge,
  );
  let sceneSummary = baseSummary;
  if (guidance && baseSummary.length + guidance.length + 2 <= LIMITS.sceneSummary) sceneSummary = `${baseSummary}\n\n${guidance}`;

  return {
    image: input.image,
    sceneSummary: sceneSummary.slice(0, LIMITS.sceneSummary),
    zones: zones.map((z) => ({ id: z.id, kind: z.kind, label: z.label, description: z.description, sun: z.sun ?? null })),
    paths: paths.map((p) => ({ id: p.id, label: p.label, description: pathDescription(p) })),
    location: locationForApi(input.location),
    climate: exterior ? climateText(input.location) : null,
    brief: {
      prompt: brief.prompt.trim().slice(0, LIMITS.prompt),
      scope: brief.scope,
      plantMaturity: brief.plantMaturity,
      ...(brief.strictness ? { strictness: brief.strictness } : {}),
      targetZoneLabels: brief.targetZoneIds.map((id) => zoneById.get(id)?.label).filter((l): l is string => !!l),
      elements,
    },
    ideas: input.ideas.map((i) => ideaText(i, knowledge.getTheme)).filter(Boolean),
    ideaImages: input.ideaImages.slice(0, 3),
    count: compare ? compare.options.length : Math.min(6, Math.max(1, Math.round(input.count))),
    compare: compare
      ? {
          elementLabel: compare.element.label.trim() || knowledge.getElementDef(compare.element.type).label,
          dimensionLabel: compare.dimension.label,
          options: compare.options.map((o) => ({ id: o.id, label: o.label, promptText: o.promptText })),
        }
      : null,
    refine: input.refine ?? null,
  };
}

/**
 * Instruction for a compared option the plan skipped: a sibling's
 * instruction with the sibling's option wording swapped for this option's
 * (or the option's wording appended when the sibling doesn't quote it).
 */
export function swapOptionInBrief(
  siblingBrief: string,
  sibling: Pick<ElementOption, 'promptText'> | undefined,
  option: Pick<ElementOption, 'promptText'>,
  dimensionLabel: string,
): string {
  if (sibling && sibling.promptText && siblingBrief.includes(sibling.promptText)) return siblingBrief.split(sibling.promptText).join(option.promptText);
  return `${siblingBrief.trim()} For the ${dimensionLabel.toLowerCase()}, use ${option.promptText} instead.`;
}
