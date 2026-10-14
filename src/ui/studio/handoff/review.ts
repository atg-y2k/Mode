/**
 * The review step (ReimagineHome's "confirmation"): before a run renders or
 * is handed off, the user sees Claude's plan, each variation's exact
 * instruction (editable), the marked preview and what stays protected, and
 * chooses Send or Edit. generate.ts opens the review when a run starts and
 * waits for the decision once the plan is ready; ReviewModal (mounted once by
 * the Workspace whenever a project is open, on every pane and viewport)
 * registers itself as the host — without a host (tests, scripts) runs skip
 * the review.
 */
import { create } from 'zustand';
import type { HandoffApp, PlantNote, Variation } from '../../../../shared/types';

export interface ReviewItem {
  /** Slot key = planned variation id. */
  key: string;
  title: string;
  brief: string;
  optionLabel?: string;
}

export interface ReviewRequest {
  generationId: string;
  photoId: string;
  renderMode: 'handoff' | 'api';
  app: HandoffApp;
  runMode: 'variations' | 'compare';
  /** Variations asked for (planning placeholder count). */
  count: number;
  /** Starts from a variation instead of the original photo. */
  baseVariationId?: string;
  stage: 'planning' | 'ready';
  plan?: string;
  plantNotes?: PlantNote[];
  items?: ReviewItem[];
  /** 'template' when the server had no Claude and assembled the plan from the brief. */
  planSource?: 'ai' | 'template' | null;
}

export const useReview = create<{ current: ReviewRequest | null }>(() => ({ current: null }));

/** Shown when the server planned without Claude (its template of the brief): plain information (the keyless state is said once, in Settings). */
export const TEMPLATE_PLAN_NOTE = 'Planned from your choices — edit any instruction before sending.';

/**
 * Which image the run sends: "Starting from: your original photo", or
 * "Starting from: “Curved bluestone” (a ChatGPT result)". `base` is the
 * run's starting variation (undefined: the original photo).
 */
export function startingFromText(base: Pick<Variation, 'title' | 'source'> | undefined): string {
  if (!base) return 'Starting from: your original photo';
  const src = base.source;
  const made = !src ? '' : src.kind === 'api' ? ' (an image API result)' : ` (a ${src.app === 'gemini' ? 'Gemini' : 'ChatGPT'} result)`;
  return `Starting from: “${base.title}”${made}`;
}

/** Compare runs whose (kept) instructions are all the same text: the options would not differ. */
export function identicalInstructions(items: readonly Pick<ReviewItem, 'brief'>[]): boolean {
  if (items.length < 2) return false;
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  const first = norm(items[0].brief);
  return items.every((i) => norm(i.brief) === first);
}

/** The review footer for `n` hand-offs: each is its own chat. */
export function handoffFooter(n: number): string {
  return n === 1 ? '1 hand-off — start a new chat for it.' : `${n} hand-offs — each in a new chat. You can do some now and the rest later.`;
}

let hosts = 0;
let waiting: { generationId: string; resolve: (items: ReviewItem[] | null) => void } | null = null;

/** Called by the mounted review modal; returns the unregister function. */
export function registerReviewHost(): () => void {
  hosts++;
  return () => {
    hosts = Math.max(0, hosts - 1);
  };
}

export function reviewAvailable(): boolean {
  return hosts > 0;
}

function settle(items: ReviewItem[] | null): void {
  const w = waiting;
  waiting = null;
  w?.resolve(items);
}

/** Shows the review for a run that is planning. A newer run's review replaces an older one (declined). */
export function openReview(req: Omit<ReviewRequest, 'stage'>): void {
  if (waiting && waiting.generationId !== req.generationId) settle(null);
  useReview.setState({ current: { ...req, stage: 'planning' } });
}

/**
 * Called by the run once its plan is ready: shows it and resolves with the
 * (possibly edited, possibly fewer) items on Send, or null when the user
 * backs out — also when the review was already closed.
 */
export function awaitReview(generationId: string, data: Pick<ReviewRequest, 'plan' | 'plantNotes' | 'items' | 'planSource'>): Promise<ReviewItem[] | null> {
  const cur = useReview.getState().current;
  if (!cur || cur.generationId !== generationId) return Promise.resolve(null);
  if (waiting) settle(null);
  useReview.setState({ current: { ...cur, ...data, stage: 'ready' } });
  return new Promise((resolve) => {
    waiting = { generationId, resolve };
  });
}

/** Send: the run continues with these items. */
export function submitReview(generationId: string, items: ReviewItem[]): void {
  if (useReview.getState().current?.generationId === generationId) useReview.setState({ current: null });
  if (waiting?.generationId === generationId) settle(items);
}

/** Close / Edit: the run is not sent (the caller cancels it). */
export function declineReview(generationId: string): void {
  if (useReview.getState().current?.generationId === generationId) useReview.setState({ current: null });
  if (waiting?.generationId === generationId) settle(null);
}

/** The run ended without a decision (planning failed, run deleted): close its review. */
export function closeReview(generationId: string): void {
  declineReview(generationId);
}
