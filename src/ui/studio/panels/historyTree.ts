/**
 * Branching history (borrowed from InvokeAI / Yardzen version trees): a
 * photo's runs as a tree by the image they started from — the original
 * photo, then each variation that later runs used as their base. Plus the
 * small per-variation facts History shows: where an image came from
 * (ChatGPT / Gemini / API) and whether its alignment needs a look, and how
 * many hand-offs a run is still waiting for. Pure; unit-tested.
 */
import type { Generation, Variation, VariationSource } from '../../../../shared/types';

export interface RunNode {
  run: Generation;
  /** The variation this run started from (null = the original photo). */
  base: { variation: Variation; run: Generation } | null;
  /** The run named a base variation that no longer exists (it hangs off the original). */
  baseMissing: boolean;
  /** Runs started from this run's variations, newest first. */
  children: RunNode[];
  /** Kept by a filter only to connect a matching run further down the branch. */
  context?: boolean;
}

/**
 * Runs as a tree: roots started from the original photo (or from a deleted
 * variation); each run's children started from one of its variations.
 * Order follows `generations` (newest first). Cycles cannot happen in real
 * data; if one did, the run would be shown as a root.
 */
export function buildRunTree(generations: readonly Generation[]): RunNode[] {
  const owner = new Map<string, { variation: Variation; run: Generation }>();
  for (const g of generations) for (const v of g.variations) owner.set(v.id, { variation: v, run: g });

  const nodes = new Map<string, RunNode>();
  for (const g of generations) {
    const base = g.baseVariationId ? owner.get(g.baseVariationId) ?? null : null;
    nodes.set(g.id, { run: g, base, baseMissing: !!g.baseVariationId && !base, children: [] });
  }

  /** Walks up the bases: true when `g` descends from itself (corrupt data). */
  const cyclic = (g: Generation): boolean => {
    const seen = new Set<string>([g.id]);
    let cur = nodes.get(g.id)?.base?.run;
    while (cur) {
      if (seen.has(cur.id)) return true;
      seen.add(cur.id);
      cur = nodes.get(cur.id)?.base?.run;
    }
    return false;
  };

  const roots: RunNode[] = [];
  for (const g of generations) {
    const node = nodes.get(g.id)!;
    const parent = node.base && node.base.run.id !== g.id && !cyclic(g) ? nodes.get(node.base.run.id) : undefined;
    if (parent) parent.children.push(node);
    else {
      if (node.base && !parent) node.base = null;
      roots.push(node);
    }
  }
  return roots;
}

/** Keeps runs that match (and the runs on the way to them, marked `context`). */
export function filterRunTree(nodes: readonly RunNode[], keep: (g: Generation) => boolean): RunNode[] {
  const out: RunNode[] = [];
  for (const n of nodes) {
    const children = filterRunTree(n.children, keep);
    if (keep(n.run)) out.push({ ...n, children });
    else if (children.length) out.push({ ...n, children, context: true });
  }
  return out;
}

/** Every run in the tree, pre-order with its depth (0 = from the original). */
export function flattenRunTree(nodes: readonly RunNode[], depth = 0): { node: RunNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenRunTree(n.children, depth + 1)]);
}

/** variation id → number of runs started from it. */
export function branchCounts(generations: readonly Generation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of generations) if (g.baseVariationId) m.set(g.baseVariationId, (m.get(g.baseVariationId) ?? 0) + 1);
  return m;
}

/** Runs that have favorites (filter predicate). */
export function hasFavorites(g: Generation): boolean {
  return g.variations.some((v) => v.favorite);
}

// ---------------------------------------------------------------------------
// Provenance & alignment
// ---------------------------------------------------------------------------

/** Share of protected pixels changed above which a result needs a look (the model redrew the scene). */
export const OUTSIDE_CHANGED_WARN = 0.15;

export interface Provenance {
  /** "ChatGPT" | "Gemini" | "API" — null for images from before provenance was recorded. */
  label: string | null;
  /** For tiny tiles: "GPT" | "Gemini" | "API". */
  short: string | null;
  kind: VariationSource['kind'] | null;
  app?: VariationSource['app'];
  /** Alignment needs a look: it fell back to a plain resize, or the model changed much of what should stay. */
  warn: boolean;
  /** Why, for the tooltip. */
  warning?: string;
}

export function provenanceOf(source: VariationSource | undefined): Provenance {
  if (!source) return { label: null, short: null, kind: null, warn: false };
  const label = source.kind === 'api' ? 'API' : source.app === 'gemini' ? 'Gemini' : 'ChatGPT';
  const short = label === 'ChatGPT' ? 'GPT' : label;
  const a = source.alignment;
  let warning: string | undefined;
  if (a && a.aligned === false) {
    warning = `Rough fit: the result didn't line up reliably with your photo (${a.inliers} matching features), so it was fitted by size only. Check the edges of the change.`;
  } else if (a && a.outsideChanged > OUTSIDE_CHANGED_WARN) {
    warning = `The model changed ${Math.round(a.outsideChanged * 100)}% of the area that should have stayed the same. Mode restored it from your photo, but the edit may not blend well.`;
  }
  return { label, short, kind: source.kind, ...(source.app ? { app: source.app } : {}), warn: !!warning, ...(warning ? { warning } : {}) };
}

// ---------------------------------------------------------------------------
// Hand-offs
// ---------------------------------------------------------------------------

export interface HandoffCounts {
  /** Planned variations still to take to ChatGPT / Gemini. */
  waiting: number;
  /** Returned images waiting in staging (accept / reject). */
  staged: number;
}

export function handoffCounts(g: Pick<Generation, 'planned'>): HandoffCounts {
  let waiting = 0;
  let staged = 0;
  for (const p of g.planned ?? []) {
    if (p.status === 'awaiting-handoff') waiting++;
    else if (p.status === 'staged') staged++;
  }
  return { waiting, staged };
}

/** "2 waiting for hand-off · 1 to review". Empty when nothing is pending. */
export function handoffText(c: HandoffCounts): string {
  return [c.waiting ? `${c.waiting} waiting for hand-off` : '', c.staged ? `${c.staged} to review` : ''].filter(Boolean).join(' · ');
}

/** Event the hand-off companion listens for: open it on a run's pending items. */
export const OPEN_HANDOFF_EVENT = 'mode:open-handoff';

export interface OpenHandoffDetail {
  generationId: string;
}

/**
 * Asks the hand-off companion (src/ui/studio/handoff) to open on a run's
 * pending items. The event is cancelable: a listener that takes it over calls
 * preventDefault(), and this returns true; false = nobody handled it (the
 * caller falls back to opening the first pending item itself).
 */
export function requestOpenHandoff(generationId: string): boolean {
  if (typeof window === 'undefined') return false;
  const event = new CustomEvent<OpenHandoffDetail>(OPEN_HANDOFF_EVENT, { detail: { generationId }, cancelable: true });
  return !window.dispatchEvent(event);
}

/** The run's planned item to open first: one still waiting for a hand-off, else one waiting in staging. */
export function firstPendingPlanned(g: Pick<Generation, 'planned'>): string | null {
  const planned = g.planned ?? [];
  return (planned.find((p) => p.status === 'awaiting-handoff') ?? planned.find((p) => p.status === 'staged'))?.id ?? null;
}
