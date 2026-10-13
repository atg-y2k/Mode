/**
 * Suggested-edit chips (borrowed from ReimagineHome's "suggested edits"):
 * one-click additions to the brief computed from what Mode already knows
 * about the photo — the scene map's redesign opportunities and the latest AI
 * recommendations. Each chip becomes a Recommendation-shaped edit so the
 * existing brief merge (prompt once + element + target zones) applies.
 *
 * Opportunities are free text ("Widen the entry walk to 5 ft"), so the
 * element and the areas they refer to are inferred from their words: the
 * element from keywords (restricted to the elements offered for the photo's
 * setting), the areas from zone labels the text mentions. Pure; unit-tested.
 */
import type { DesignBrief, ElementType, Recommendation, RecommendationCategory, SceneMap, SceneZone } from '../../../../shared/types';
import { isDesignZone } from './zones';

export interface SuggestedEdit {
  /** Stable key (source + normalized text). */
  id: string;
  /** Short chip text. */
  label: string;
  /** Full text for the tooltip. */
  title: string;
  source: 'scene' | 'ai';
  /** What gets merged into the brief. */
  rec: Recommendation;
}

/** Keywords → element, most specific first. `setting` limits which photos the rule applies to. */
const ELEMENT_KEYWORDS: { type: ElementType; re: RegExp; setting?: 'interior' | 'exterior' }[] = [
  { type: 'border-edging', re: /\b(edging|edge|edged|border|borders|curbing)\b/ },
  { type: 'garage-door', re: /\bgarage( doors?)?\b/ },
  { type: 'front-door', re: /\b(front door|entry door|door|doors|doorway)\b/, setting: 'exterior' },
  { type: 'windows-shutters', re: /\b(shutters?|window boxes?|window trim)\b/ },
  { type: 'steps', re: /\b(steps|stairs?|stoop)\b/, setting: 'exterior' },
  { type: 'driveway', re: /\bdriveway\b/ },
  { type: 'pathway', re: /\b(walk|walks|walkway|walkways|path|paths|pathway|stepping stones?|pavers?)\b/ },
  { type: 'patio', re: /\b(patio|terrace|seating area|fire pit)\b/ },
  { type: 'porch', re: /\b(porch|portico|columns?)\b/ },
  { type: 'retaining-wall', re: /\bretaining walls?\b/ },
  { type: 'fence', re: /\b(fence|fencing|privacy screen|hedge screen)\b/ },
  { type: 'water-feature', re: /\b(fountain|pond|water feature|birdbath)\b/ },
  { type: 'outdoor-lighting', re: /\b(light|lights|lighting|lanterns?|sconces?|uplights?)\b/, setting: 'exterior' },
  { type: 'interior-lighting', re: /\b(light|lights|lighting|pendants?|chandeliers?|sconces?|lamps?)\b/, setting: 'interior' },
  { type: 'trees-shrubs', re: /\b(trees?|shrubs?|hedges?|specimen|screening)\b/ },
  { type: 'lawn', re: /\b(lawn|turf|grass|clover|meadow)\b/ },
  { type: 'planting-bed', re: /\b(beds?|planting|plantings|planted|perennials?|flowers?|foundation planting|garden|pollinator|groundcover)\b/ },
  { type: 'roof', re: /\broof(ing|line)?\b/ },
  { type: 'exterior-paint', re: /\b(paint|repaint|painted|colou?r scheme|siding|trim colou?r|body colou?r)\b/, setting: 'exterior' },
  { type: 'outdoor-furniture', re: /\b(bench|benches|chairs?|furniture|planters?)\b/, setting: 'exterior' },
  { type: 'flooring', re: /\b(floor|floors|flooring|hardwood|tile floor)\b/ },
  { type: 'cabinets', re: /\b(cabinets?|cabinetry)\b/ },
  { type: 'countertops', re: /\bcounter(top)?s?\b/ },
  { type: 'backsplash', re: /\bbacksplash\b/ },
  { type: 'fireplace', re: /\b(fireplace|mantel|hearth)\b/ },
  { type: 'window-treatments', re: /\b(curtains?|drapes?|drapery|blinds|shades|window treatments?)\b/ },
  { type: 'ceiling', re: /\bceiling\b/ },
  { type: 'wall-paint', re: /\b(paint|repaint|painted|walls?|accent wall|wallpaper|colou?r)\b/, setting: 'interior' },
  { type: 'furniture', re: /\b(sofa|couch|furniture|seating|table|rug)\b/, setting: 'interior' },
  { type: 'decor', re: /\b(art|artwork|decor|plants?|shelves|styling)\b/, setting: 'interior' },
];

const CATEGORY_OF: Partial<Record<ElementType, RecommendationCategory>> = {
  pathway: 'hardscape',
  'border-edging': 'hardscape',
  driveway: 'hardscape',
  steps: 'hardscape',
  patio: 'hardscape',
  'retaining-wall': 'hardscape',
  'planting-bed': 'landscaping',
  lawn: 'landscaping',
  'trees-shrubs': 'landscaping',
  fence: 'landscaping',
  'water-feature': 'landscaping',
  'outdoor-lighting': 'lighting',
  'interior-lighting': 'lighting',
  'exterior-paint': 'paint',
  'wall-paint': 'paint',
  'front-door': 'architecture',
  'garage-door': 'architecture',
  'windows-shutters': 'architecture',
  porch: 'architecture',
  roof: 'architecture',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?;,\s]+$/g, '').trim();
}

/**
 * The element an opportunity's text is about (null when no keyword matches an
 * offered element): the first thing it names, except that a noun used as a
 * modifier yields to the noun after it ("path lighting" → lighting, "bed
 * edging" → edging).
 */
export function inferElementType(text: string, setting: 'interior' | 'exterior', offered: ReadonlySet<ElementType>): ElementType | null {
  const t = text.toLowerCase();
  const hits: { type: ElementType; start: number; end: number }[] = [];
  for (const rule of ELEMENT_KEYWORDS) {
    if (rule.setting && rule.setting !== setting) continue;
    if (!offered.has(rule.type)) continue;
    const m = new RegExp(rule.re.source, 'g').exec(t);
    if (m) hits.push({ type: rule.type, start: m.index, end: m.index + m[0].length });
  }
  if (hits.length === 0) return null;
  // Stable: equal starts keep the rule order (more specific rules first).
  hits.sort((a, b) => a.start - b.start);
  let pick = hits[0];
  for (const next of hits) {
    if (next.type !== pick.type && next.start >= pick.end && next.start <= pick.end + 1) pick = next;
  }
  return pick.type;
}

/** Words of a zone label that identify it ("Front walk" → walk); location words are too generic to match on. */
const GENERIC_WORDS = new Set([
  'the', 'and', 'with', 'front', 'back', 'rear', 'left', 'right', 'side', 'main', 'area', 'areas', 'existing', 'house', 'near', 'along', 'by', 'of', 'to', 'at',
  'small', 'large', 'big', 'upper', 'lower', 'center', 'centre', 'middle', 'corner', 'yard', 'space', 'zone', 'part', 'entry', 'street', 'old', 'new', 'top',
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // "walk" ↔ "walkway", "plant" ↔ "planting": shared stem of 4+ letters.
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Editable zones the text mentions by name ("the entry walk" → "Front walk").
 * With an element, only zones of the element's kinds count when there are any
 * such matches (a "walk" opportunity shouldn't target a lawn named "Lawn by
 * the walk").
 */
export function zonesMentioned(text: string, zones: readonly SceneZone[], kinds?: readonly string[]): string[] {
  const textWords = words(text).filter((w) => !GENERIC_WORDS.has(w));
  const scored = zones
    .filter(isDesignZone)
    .map((z) => {
      const label = words(z.label).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
      return { z, score: label.filter((lw) => textWords.some((tw) => wordsMatch(lw, tw))).length };
    })
    .filter((x) => x.score > 0);
  let hits = scored;
  if (kinds && kinds.length) {
    const ofKind = hits.filter((x) => kinds.includes(x.z.kind));
    if (ofKind.length) hits = ofKind;
  }
  // "the foundation bed" names one bed: keep the zones matching the most words.
  const best = Math.max(0, ...hits.map((x) => x.score));
  return hits.filter((x) => x.score === best).map((x) => x.z.id);
}

/** "Widen the entry walk to 5 ft so two people can pass" → "Widen the entry walk to 5 ft". */
export function shortLabel(text: string, max = 44): string {
  const t = text.trim().replace(/[.!]+$/, '');
  const clause = t.split(/(?:[;:—–(]| - |,? (?:so|so that|because|which|while|to keep|to give|to create)\b)/)[0].trim();
  const base = clause.length >= 12 ? clause : t;
  if (base.length <= max) return base;
  const cut = base.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,\s]+$/, '')}…`;
}

/** True when the brief's prompt already contains this text (added before). */
export function isInBrief(brief: Pick<DesignBrief, 'prompt'>, text: string): boolean {
  const t = normalize(text);
  return !!t && normalize(brief.prompt).includes(t);
}

export interface SuggestedEditsInput {
  scene: SceneMap | undefined;
  recommendations: readonly Recommendation[] | undefined;
  brief: Pick<DesignBrief, 'prompt'>;
  setting: 'interior' | 'exterior';
  /** Element types offered for the photo (elementsForSetting). */
  offered: ReadonlySet<ElementType>;
  /** Zone kinds each element targets (ElementDef.zoneKinds). */
  zoneKindsOf: (type: ElementType) => readonly string[];
}

/**
 * Chips for the Design panel: the latest AI recommendations first (they carry
 * their element and areas), then the scene's opportunities. Duplicates and
 * edits already in the brief's prompt are left out.
 */
export function suggestedEdits(input: SuggestedEditsInput): SuggestedEdit[] {
  const out: SuggestedEdit[] = [];
  const seen = new Set<string>();
  const zones = input.scene?.zones ?? [];
  const zoneIds = new Set(zones.map((z) => z.id));

  for (const rec of input.recommendations ?? []) {
    const key = normalize(rec.prompt);
    if (!key || seen.has(key) || isInBrief(input.brief, rec.prompt)) continue;
    seen.add(key);
    seen.add(normalize(rec.title));
    out.push({
      id: `ai:${rec.id}`,
      label: shortLabel(rec.title || rec.prompt),
      title: rec.why ? `${rec.prompt}\n\n${rec.why}` : rec.prompt,
      source: 'ai',
      rec: {
        ...rec,
        // Areas deleted from the scene since the recommendation was made are dropped.
        targetZoneIds: rec.targetZoneIds.filter((id) => zoneIds.has(id)),
        elementType: rec.elementType && input.offered.has(rec.elementType) ? rec.elementType : undefined,
      },
    });
  }

  (input.scene?.opportunities ?? []).forEach((text, i) => {
    const key = normalize(text);
    if (!key || seen.has(key) || isInBrief(input.brief, text)) return;
    seen.add(key);
    const elementType = inferElementType(text, input.setting, input.offered);
    const kinds = elementType ? input.zoneKindsOf(elementType) : undefined;
    out.push({
      id: `scene:${i}:${key.slice(0, 40)}`,
      label: shortLabel(text),
      title: text.trim(),
      source: 'scene',
      rec: {
        id: `opportunity-${i}`,
        title: shortLabel(text, 60),
        prompt: text.trim(),
        why: '',
        category: (elementType && CATEGORY_OF[elementType]) || (input.setting === 'interior' ? 'interior' : 'other'),
        targetZoneIds: zonesMentioned(text, zones, kinds),
        ...(elementType ? { elementType } : {}),
      },
    });
  });
  return out;
}
