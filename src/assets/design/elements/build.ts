/**
 * Authoring types for the built-in design elements. Options are written with
 * a required visual and rationale, plus (for plant options) the plant
 * profiles they imply; `buildElements` strips the plant lists into a lookup
 * table so the published ElementDefs are plain shared types.
 */
import type { ElementDef, ElementDimension, ElementOption, OptionVisual } from '../../../../shared/types';
import type { PlantId } from '../plants';

export interface OptionInput {
  id: string;
  label: string;
  description: string;
  promptText: string;
  visual: OptionVisual;
  rationale: string;
  /** Plants this option puts in the ground (drives its feasibility badge). */
  plants?: PlantId[];
  /** 'all' = planted together (default); 'any' = alternatives for different conditions. */
  plantMode?: 'all' | 'any';
}

export interface DimensionInput {
  id: string;
  label: string;
  question: string;
  multiple?: boolean;
  defaultOptionId?: string;
  options: OptionInput[];
}

export interface ElementInput extends Omit<ElementDef, 'dimensions'> {
  dimensions: DimensionInput[];
}

export interface OptionPlants {
  plants: PlantId[];
  mode: 'all' | 'any';
}

export function optionKey(type: string, dimensionId: string, optionId: string): string {
  return `${type}/${dimensionId}/${optionId}`;
}

export function buildElements(inputs: ElementInput[]): { defs: ElementDef[]; optionPlants: Map<string, OptionPlants> } {
  const optionPlants = new Map<string, OptionPlants>();
  const defs = inputs.map((el): ElementDef => {
    const dimensions = el.dimensions.map((dim): ElementDimension => {
      const options = dim.options.map((o): ElementOption => {
        if (o.plants && o.plants.length > 0) optionPlants.set(optionKey(el.type, dim.id, o.id), { plants: [...o.plants], mode: o.plantMode ?? 'all' });
        return { id: o.id, label: o.label, description: o.description, promptText: o.promptText, visual: o.visual, rationale: o.rationale };
      });
      const out: ElementDimension = { id: dim.id, label: dim.label, question: dim.question, options };
      if (dim.multiple) out.multiple = true;
      if (dim.defaultOptionId) out.defaultOptionId = dim.defaultOptionId;
      return out;
    });
    return { type: el.type, label: el.label, description: el.description, icon: el.icon, setting: el.setting, zoneKinds: [...el.zoneKinds], dimensions };
  });
  return { defs, optionPlants };
}

/** Shared "no lights / none" style option. */
export function noneOption(id: string, label: string, description: string, promptText: string, rationale: string): OptionInput {
  return { id, label, description, promptText, rationale, visual: { kind: 'diagram', diagram: 'none' } };
}
