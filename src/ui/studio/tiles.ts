/**
 * What the variation strip and the compare grid show for a run (pure):
 * finished variations in planned order, placeholders for variations still
 * planning / rendering, failed ones (with their error, retryable), and — for
 * compare runs from an earlier session — options that never rendered.
 */
import type { ElementDimension, ElementOption, ElementSpec, Generation, Variation } from '../../../shared/types';
import type { RunInfo, SlotState } from './runs';

export interface Tile {
  key: string;
  state: SlotState | 'missing';
  variation?: Variation;
  /** Planned title, option label or the variation's title. */
  label: string;
  optionId?: string;
  /** Live slot key (retry a single failed variation). */
  slotKey?: string;
  error?: string;
}

export interface CompareContext {
  element: ElementSpec | undefined;
  elementLabel: string;
  dimension: ElementDimension | undefined;
  dimensionLabel: string;
  /** Compared options in run order (may be fewer than optionIds when the brief snapshot lacks them). */
  options: ElementOption[];
}

/** The compared element / dimension / options of a compare run, from its brief snapshot. */
export function compareContext(g: Generation): CompareContext | null {
  if (g.mode !== 'compare' || !g.compare) return null;
  const element = g.brief.elements.find((e) => e.id === g.compare!.elementId);
  const dimension = element?.dimensions.find((d) => d.id === g.compare!.dimensionId);
  const options = g.compare.optionIds.map((id) => dimension?.options.find((o) => o.id === id)).filter((o): o is ElementOption => !!o);
  return {
    element,
    elementLabel: element?.label || 'Element',
    dimension,
    dimensionLabel: dimension?.label || 'Option',
    options,
  };
}

export function compareOption(g: Generation, optionId: string | undefined): ElementOption | undefined {
  if (!optionId) return undefined;
  return compareContext(g)?.options.find((o) => o.id === optionId);
}

function variationTile(v: Variation): Tile {
  return { key: v.id, state: 'done', variation: v, label: v.optionLabel || v.title, ...(v.optionId ? { optionId: v.optionId } : {}) };
}

/** Tiles of a run, in display order. */
export function runTiles(g: Generation, info: RunInfo | undefined): Tile[] {
  const byId = new Map(g.variations.map((v) => [v.id, v]));
  if (info) {
    const used = new Set<string>();
    const tiles: Tile[] = [];
    for (const slot of info.slots) {
      const v = slot.variationId ? byId.get(slot.variationId) : undefined;
      if (v) {
        used.add(v.id);
        tiles.push(variationTile(v));
        continue;
      }
      if (slot.state === 'done') continue; // saved, then deleted
      tiles.push({
        key: `slot:${slot.key}`,
        state: slot.state,
        label: slot.optionLabel || slot.title,
        slotKey: slot.key,
        ...(slot.optionId ? { optionId: slot.optionId } : {}),
        ...(slot.error ? { error: slot.error } : {}),
      });
    }
    for (const v of g.variations) if (!used.has(v.id)) tiles.push(variationTile(v));
    return tiles;
  }

  const ordered = [...g.variations].sort((a, b) => a.createdAt - b.createdAt);
  const ctx = compareContext(g);
  if (!ctx || !g.compare) return ordered.map(variationTile);
  const index = (id: string | undefined) => {
    const i = id ? g.compare!.optionIds.indexOf(id) : -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const tiles = ordered.sort((a, b) => index(a.optionId) - index(b.optionId)).map(variationTile);
  if (g.status !== 'running') {
    const have = new Set(g.variations.map((v) => v.optionId));
    for (const o of ctx.options) {
      if (have.has(o.id)) continue;
      tiles.splice(Math.min(tiles.length, index(o.id)), 0, { key: `missing:${o.id}`, state: 'missing', label: o.label, optionId: o.id });
    }
  }
  return tiles;
}

/** Finished variations of a run in display order (keyboard stepping). */
export function runVariations(g: Generation, info: RunInfo | undefined): Variation[] {
  return runTiles(g, info)
    .map((t) => t.variation)
    .filter((v): v is Variation => !!v);
}
