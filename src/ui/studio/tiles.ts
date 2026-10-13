/**
 * What the variation strip and the compare grid show for a run (pure):
 * finished variations in planned order, placeholders for variations still
 * planning / rendering, failed ones (with their error, retryable), manual
 * hand-offs waiting for the user or waiting in staging, and — for compare
 * runs from an earlier session without a recorded plan — options that never
 * rendered.
 */
import type { ElementDimension, ElementOption, ElementSpec, Generation, HandoffApp, PlannedVariation, Variation } from '../../../shared/types';
import type { RunInfo, SlotState } from './runs';

export type TileState = SlotState | 'missing' | 'awaiting' | 'staged';

export interface Tile {
  key: string;
  state: TileState;
  variation?: Variation;
  /** Planned title, option label or the variation's title. */
  label: string;
  optionId?: string;
  /** Slot key to retry a single failed variation (live slot, or the planned item's id). */
  slotKey?: string;
  error?: string;
  /** The run's planned item behind this tile (hand-offs, runs recorded with a plan). */
  plannedId?: string;
  /** Hand-off result waiting for Accept / Reject. */
  staged?: PlannedVariation['staged'];
  /** App a waiting hand-off was prepared for. */
  app?: HandoffApp;
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

  if (g.planned && g.planned.length > 0) return plannedTiles(g, g.planned, byId);

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

/** Tiles from the persisted plan (hand-off runs, and API runs after a reload). */
function plannedTiles(g: Generation, planned: readonly PlannedVariation[], byId: Map<string, Variation>): Tile[] {
  const used = new Set<string>();
  const tiles: Tile[] = [];
  for (const p of planned) {
    const base = {
      key: `planned:${p.id}`,
      label: p.optionLabel || p.title,
      plannedId: p.id,
      ...(p.optionId ? { optionId: p.optionId } : {}),
    };
    switch (p.status) {
      case 'done': {
        const v = p.variationId ? byId.get(p.variationId) : undefined;
        if (v) {
          used.add(v.id);
          tiles.push({ ...variationTile(v), plannedId: p.id });
        }
        break; // accepted, then deleted: nothing to show
      }
      case 'rejected':
        break; // skipped by the user
      case 'awaiting-handoff':
        tiles.push({ ...base, state: 'awaiting', ...(p.handoff ? { app: p.handoff.app } : {}) });
        break;
      case 'staged':
        tiles.push({ ...base, state: 'staged', staged: p.staged, ...(p.staged?.source.app ? { app: p.staged.source.app } : {}) });
        break;
      case 'pending':
        tiles.push(
          g.status === 'running'
            ? { ...base, state: 'pending' }
            : { ...base, state: 'failed', slotKey: p.id, error: p.error || 'Interrupted before it rendered.' },
        );
        break;
      case 'failed':
        tiles.push({ ...base, state: 'failed', slotKey: p.id, error: p.error || 'This variation failed.' });
        break;
    }
  }
  for (const v of g.variations) if (!used.has(v.id)) tiles.push(variationTile(v));
  return tiles;
}

/** Finished variations of a run in display order (keyboard stepping). */
export function runVariations(g: Generation, info: RunInfo | undefined): Variation[] {
  return runTiles(g, info)
    .map((t) => t.variation)
    .filter((v): v is Variation => !!v);
}
