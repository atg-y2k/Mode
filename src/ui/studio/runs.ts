/**
 * Live state of Studio runs that the persisted Generation doesn't carry:
 * the planned variations ("slots") with their instruction, per-slot status
 * (pending / rendering / done / failed + error) and whether the run is still
 * working. Written by generate.ts, read by the variation strip and the
 * compare grid (useRunInfo). In memory only — after a reload, finished
 * variations come from the project and unfinished runs are marked
 * interrupted (see recoverInterruptedRuns in generate.ts).
 */
import { useSyncExternalStore } from 'react';

export type SlotState = 'pending' | 'rendering' | 'done' | 'failed';

export interface RunSlot {
  /** Stable within the run. */
  key: string;
  /** Planned title (empty until the plan arrives for 'variations' runs). */
  title: string;
  /** Image-edit instruction (empty until planned). Retries reuse it. */
  brief: string;
  optionId?: string;
  optionLabel?: string;
  state: SlotState;
  error?: string;
  /** Set once the variation is saved. */
  variationId?: string;
}

export interface RunInfo {
  generationId: string;
  photoId: string;
  /** 'planning' → 'rendering' → 'finished' (also after cancel / failure). */
  stage: 'planning' | 'rendering' | 'finished';
  slots: RunSlot[];
}

const infos = new Map<string, RunInfo>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRunInfo(generationId: string): RunInfo | undefined {
  return infos.get(generationId);
}

/** Replaces a run's info (immutable updates keep React snapshots stable). */
export function setRunInfo(info: RunInfo): void {
  infos.set(info.generationId, info);
  emit();
}

export function patchRunInfo(generationId: string, patch: Partial<Omit<RunInfo, 'generationId'>>): void {
  const cur = infos.get(generationId);
  if (!cur) return;
  infos.set(generationId, { ...cur, ...patch });
  emit();
}

export function patchSlot(generationId: string, key: string, patch: Partial<RunSlot>): void {
  const cur = infos.get(generationId);
  if (!cur) return;
  infos.set(generationId, { ...cur, slots: cur.slots.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  emit();
}

export function forgetRunInfo(generationId: string): void {
  if (infos.delete(generationId)) emit();
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live slots of a run (undefined for runs from an earlier session). */
export function useRunInfo(generationId: string | null | undefined): RunInfo | undefined {
  return useSyncExternalStore(
    subscribeRuns,
    () => (generationId ? infos.get(generationId) : undefined),
    () => undefined,
  );
}
