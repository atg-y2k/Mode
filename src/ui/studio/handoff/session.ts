/**
 * Hand-off UI session (memory only): which planned item the companion is
 * working on, whether the companion is open / collapsed / floating in a
 * Picture-in-Picture window, the item shown in staging, per-item progress
 * (preparing the export, lining up a returned image), the import extras
 * of staged results (a hot cache: the checks, outside boxes and a small
 * change map are also saved on the staged result and restored by staging
 * after a reload), the Downloads watcher and the "Import copied image?"
 * offer. Persisted state lives on Generation.planned.
 */
import { create } from 'zustand';
import type { PlannedRef } from './planned';
import { sameRef } from './planned';

export interface ImportExtras {
  /** 0..255 change intensity outside the target (downscaled). */
  changeMap: { width: number; height: number; data: Uint8Array };
  /** Photo-px boxes of notable outside changes. */
  blobs: { x: number; y: number; w: number; h: number; area: number }[];
  /** Why feature alignment wasn't trusted (shown when the result was fitted by size only). */
  alignNote?: string;
  /** Wrong-image check: nothing changed inside the area (the original or an older image came back). */
  unchanged?: boolean;
  /** Gemini result whose bottom-right sparkle lands inside the kept area. */
  watermark?: boolean;
}

export interface ItemJob {
  kind: 'preparing' | 'importing';
  /** Shown under the spinner. */
  message: string;
}

export interface HandoffSessionState {
  /** Item the companion shows. */
  active: PlannedRef | null;
  /** Inline companion: open card, collapsed pill, or hidden. */
  companion: 'open' | 'collapsed' | 'closed';
  /** Document Picture-in-Picture window hosting the companion, when open. */
  pip: Window | null;
  /** Item shown in the staging view (replaces the viewer). */
  staging: PlannedRef | null;
  jobs: Record<string, ItemJob>;
  extras: Record<string, ImportExtras>;
  /** Item errors from the last prepare / import attempt. */
  errors: Record<string, string>;
  /** Downloads watcher status. */
  watch: { on: boolean; available: boolean | null; dir: string | null; error: string | null };
  /** clipboardchange saw an image while a hand-off is pending. */
  clipboardOffer: boolean;
  /** Something is being dragged over a drop zone (files or a link). */
  dragging: boolean;
  /** Project the items above belong to (switching projects forgets them). */
  projectId: string | null;
}

export const useHandoffSession = create<HandoffSessionState>()(() => ({
  active: null,
  companion: 'closed',
  pip: null,
  staging: null,
  jobs: {},
  extras: {},
  errors: {},
  watch: { on: false, available: null, dir: null, error: null },
  clipboardOffer: false,
  dragging: false,
  projectId: null,
}));

export const setHandoffSession = (patch: Partial<HandoffSessionState>): void => useHandoffSession.setState(patch);

/**
 * Called with the open project's id: when it changed, the session forgets
 * the old project's items (the companion closes; the watcher status stays).
 */
export function syncHandoffProject(projectId: string | null): void {
  const s = handoffSession();
  if (s.projectId === projectId) return;
  const first = s.projectId === null && !s.active && !s.staging;
  setHandoffSession(
    first ? { projectId } : { projectId, active: null, staging: null, jobs: {}, extras: {}, errors: {}, clipboardOffer: false, companion: 'closed' },
  );
}
export const handoffSession = (): HandoffSessionState => useHandoffSession.getState();

/** Makes `ref` the companion's item and opens the companion (unless it floats in PiP). */
export function focusHandoff(ref: PlannedRef, opts: { open?: boolean } = {}): void {
  const s = handoffSession();
  setHandoffSession({
    active: ref,
    companion: opts.open === false ? s.companion : s.pip ? 'collapsed' : 'open',
  });
}

export function setJob(plannedId: string, job: ItemJob | null): void {
  const jobs = { ...handoffSession().jobs };
  if (job) jobs[plannedId] = job;
  else delete jobs[plannedId];
  setHandoffSession({ jobs });
}

export function setItemError(plannedId: string, message: string | null): void {
  const errors = { ...handoffSession().errors };
  if (message) errors[plannedId] = message;
  else delete errors[plannedId];
  setHandoffSession({ errors });
}

export function setExtras(plannedId: string, extras: ImportExtras | null): void {
  const all = { ...handoffSession().extras };
  if (extras) all[plannedId] = extras;
  else delete all[plannedId];
  setHandoffSession({ extras: all });
}

export function isActive(ref: PlannedRef): boolean {
  return sameRef(handoffSession().active, ref);
}
