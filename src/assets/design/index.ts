/**
 * Design knowledge base: architectural styles, design themes, purpose-driven
 * guidance per element, and the built-in design ELEMENTS (building blocks with
 * visual choice dimensions, e.g. Pathway → material / stone size / shape /
 * width / edging / lighting). Pure data + functions, DOM-free (the server
 * imports designKnowledgeForAI for cached system prompts).
 *
 * Data lives in sibling files: styles.ts, themes.ts, guidance.ts,
 * elements/*.ts (+ plants.ts for the plants behind plant options),
 * diagrams.ts (every diagram id the option visuals use).
 */
import type {
  ArchitecturalStyle,
  AssetDef,
  DesignTheme,
  ElementDef,
  ElementGuidance,
  ElementType,
  PlantFeasibility,
} from '../../../shared/types';
import { ELEMENT_DEFS, ELEMENT_RELEVANCE } from './elements';
import { plantFeasibility as evaluatePlant, type FeasibilityContext } from './feasibility';
import { ELEMENT_GUIDANCE } from './guidance';
import { ARCHITECTURAL_STYLES } from './styles';
import { DESIGN_THEMES } from './themes';

export { ARCHITECTURAL_STYLES } from './styles';
export { DESIGN_THEMES } from './themes';
export { ELEMENT_GUIDANCE } from './guidance';
/** One ElementDef per ElementType (including 'custom'). */
export { ELEMENT_DEFS } from './elements';
export { DIAGRAM_IDS, isDiagramId, type DiagramId } from './diagrams';
export { PLANT_PROFILES, getPlantProfile, type PlantId, type PlantProfile } from './plants';
export { paletteFeasibility, profileFeasibility, invasiveNote, shortPlantName, type FeasibilityContext } from './feasibility';
export {
  getElementDef,
  newElementSpec,
  mergeDimensions,
  optionVisualFromDraft,
  withPlantFeasibility,
  optionFeasibility,
  feasibilityContext,
  parseHardinessZone,
  dominantSun,
  swatchSpanIn,
} from './spec';
export { designKnowledgeForAI } from './knowledge';

/** Elements offered for a photo, most relevant first ('both' elements included). */
export function elementsForSetting(setting: 'exterior' | 'interior'): ElementDef[] {
  const order = ELEMENT_RELEVANCE[setting];
  const rank = (t: ElementType) => {
    const i = order.indexOf(t);
    return i === -1 ? order.length : i;
  };
  return ELEMENT_DEFS.filter((d) => d.setting === setting || d.setting === 'both').sort((a, b) => rank(a.type) - rank(b.type));
}

const STYLE_BY_ID = new Map(ARCHITECTURAL_STYLES.map((s) => [s.id, s]));
const THEME_BY_ID = new Map(DESIGN_THEMES.map((t) => [t.id, t]));
const GUIDANCE_BY_TYPE = new Map(ELEMENT_GUIDANCE.map((g) => [g.type, g]));

export function getStyle(id: string): ArchitecturalStyle | undefined {
  return STYLE_BY_ID.get(id);
}

export function getTheme(id: string): DesignTheme | undefined {
  return THEME_BY_ID.get(id);
}

/**
 * Themes for a setting, ones that suit `styleId` first (in the style's own
 * pairing order, then themes that list the style in `suits`), the rest after
 * in catalog order.
 */
export function themesFor(setting: 'exterior' | 'interior', styleId?: string): DesignTheme[] {
  const pool = DESIGN_THEMES.filter((t) => t.setting === setting || t.setting === 'both');
  if (!styleId) return pool;
  const style = getStyle(styleId);
  const paired = style?.themes ?? [];
  const score = (t: DesignTheme): number => {
    const i = paired.indexOf(t.id);
    if (i !== -1) return i;
    if (t.suits.includes(styleId)) return paired.length;
    return paired.length + 1;
  };
  return pool
    .map((t, index) => ({ t, index, s: score(t) }))
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((x) => x.t);
}

export function guidanceFor(type: ElementType): ElementGuidance | undefined {
  return GUIDANCE_BY_TYPE.get(type);
}

/**
 * Offline feasibility of a catalog plant for a spot: zone range vs the
 * property's zone, sun needs vs the zone's sun, mature width vs available area.
 * Optional extras in ctx (zoneLabel, annualRainfallIn, deerPressure, setting)
 * refine the result — see FeasibilityContext.
 */
export function plantFeasibility(
  plant: AssetDef,
  ctx: { zone?: number; sun?: 'full-sun' | 'part-sun' | 'shade'; areaSqFt?: number } & FeasibilityContext,
): PlantFeasibility {
  return evaluatePlant(plant, ctx);
}
