/**
 * Design knowledge base: architectural styles, design themes, purpose-driven
 * guidance per element, and the built-in design ELEMENTS (building blocks with
 * visual choice dimensions, e.g. Pathway → material / stone size / shape /
 * width / edging / lighting). Pure data + functions, DOM-free (the server
 * imports designKnowledgeForAI for cached system prompts).
 */
import type { ElementDimensionDraft, OptionVisualDraft } from '../../../shared/api';
import type {
  ArchitecturalStyle,
  AssetDef,
  DesignTheme,
  ElementDef,
  ElementDimension,
  ElementGuidance,
  ElementSpec,
  ElementType,
  OptionVisual,
  PlantFeasibility,
  SceneMap,
} from '../../../shared/types';

export declare const ARCHITECTURAL_STYLES: ArchitecturalStyle[];
export declare const DESIGN_THEMES: DesignTheme[];
export declare const ELEMENT_GUIDANCE: ElementGuidance[];
/** One ElementDef per ElementType (including 'custom'). */
export declare const ELEMENT_DEFS: ElementDef[];

export declare function getElementDef(type: ElementType): ElementDef;
/** Elements offered for a photo, most relevant first ('both' elements included). */
export declare function elementsForSetting(setting: 'exterior' | 'interior'): ElementDef[];
export declare function getStyle(id: string): ArchitecturalStyle | undefined;
export declare function getTheme(id: string): DesignTheme | undefined;
/** Themes for a setting, ones that suit `styleId` first. */
export declare function themesFor(setting: 'exterior' | 'interior', styleId?: string): DesignTheme[];
export declare function guidanceFor(type: ElementType): ElementGuidance | undefined;

/**
 * A new ElementSpec for the brief: default label, deep copy of the built-in
 * dimensions, default choices, and zoneIds preselected from the scene by the
 * element's zoneKinds (editable zones only).
 */
export declare function newElementSpec(type: ElementType, scene?: SceneMap): ElementSpec;

/** Converts an AI option visual into an OptionVisual (texture spec with sensible unit sizes / seed). */
export declare function optionVisualFromDraft(v: OptionVisualDraft): OptionVisual | undefined;

/** Built-in dimensions refined by AI drafts: same ids merged (AI options first, deduped by label), new ids appended. */
export declare function mergeDimensions(builtin: ElementDimension[], drafts: ElementDimensionDraft[]): ElementDimension[];

/**
 * Offline feasibility of a catalog plant for a spot: zone range vs the
 * property's zone, sun needs vs the zone's sun, mature width vs available area.
 */
export declare function plantFeasibility(
  plant: AssetDef,
  ctx: { zone?: number; sun?: 'full-sun' | 'part-sun' | 'shade'; areaSqFt?: number },
): PlantFeasibility;

/**
 * Compact, deterministic text of the styles, themes and element guidance for
 * Claude system prompts (prompt-cached, so it must not vary between calls).
 */
export declare function designKnowledgeForAI(): string;
