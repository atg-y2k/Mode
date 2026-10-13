/**
 * Per-app hand-off log (this device only, localStorage 'mode.handoffLog'):
 * when the user sent a prepared photo to ChatGPT or Gemini. Used for a soft
 * hint ("6 hand-offs to ChatGPT today") — the apps don't publish fixed
 * quotas, so Mode never blocks on it — and to know which waiting items were
 * already sent. Entries older than a week are dropped.
 */
import { useSyncExternalStore } from 'react';
import type { HandoffApp } from '../../../../shared/types';
import { appLabel } from './planned';

export const HANDOFF_LOG_KEY = 'mode.handoffLog';
const KEEP_MS = 7 * 24 * 3600 * 1000;
/** Sending the same item to the same app again within this window counts once. */
const DEDUPE_MS = 15 * 60 * 1000;

export interface HandoffLogEntry {
  app: HandoffApp;
  at: number;
  plannedId?: string;
}

const listeners = new Set<() => void>();
let cache: HandoffLogEntry[] | null = null;

function parse(raw: string | null): HandoffLogEntry[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is HandoffLogEntry =>
        !!e && typeof e === 'object' && ((e as HandoffLogEntry).app === 'chatgpt' || (e as HandoffLogEntry).app === 'gemini') && Number.isFinite((e as HandoffLogEntry).at),
    );
  } catch {
    return [];
  }
}

export function readHandoffLog(): HandoffLogEntry[] {
  if (cache) return cache;
  try {
    cache = typeof localStorage === 'undefined' ? [] : parse(localStorage.getItem(HANDOFF_LOG_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

/** Pure: the log after recording a hand-off (deduped, pruned). */
export function appendEntry(log: readonly HandoffLogEntry[], entry: HandoffLogEntry): HandoffLogEntry[] {
  const fresh = log.filter((e) => entry.at - e.at < KEEP_MS);
  const dup = entry.plannedId && fresh.some((e) => e.plannedId === entry.plannedId && e.app === entry.app && entry.at - e.at < DEDUPE_MS);
  return dup ? fresh : [...fresh, entry];
}

export function recordHandoff(app: HandoffApp, plannedId?: string, now = Date.now()): void {
  const next = appendEntry(readHandoffLog(), { app, at: now, ...(plannedId ? { plannedId } : {}) });
  cache = next;
  try {
    localStorage.setItem(HANDOFF_LOG_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the hint is only for this session.
  }
  for (const l of listeners) l();
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Hand-offs to `app` since local midnight. */
export function countToday(log: readonly HandoffLogEntry[], app: HandoffApp, now = Date.now()): number {
  const since = startOfDay(now);
  return log.filter((e) => e.app === app && e.at >= since).length;
}

/** Whether this item was sent to an app already (it may be waiting in that app's chat). */
export function wasSent(log: readonly HandoffLogEntry[], plannedId: string): boolean {
  return log.some((e) => e.plannedId === plannedId);
}

/** Soft usage hint, e.g. "6 hand-offs to ChatGPT today". */
export function usageHint(app: HandoffApp, count: number): string | null {
  if (count <= 0) return null;
  return `${count} hand-off${count === 1 ? '' : 's'} to ${appLabel(app)} today`;
}

/** From this many hand-offs a day, mention switching apps when a limit is hit (the apps don't publish exact limits). */
export const BUSY_DAY = 8;

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== HANDOFF_LOG_KEY) return;
    cache = null;
    l();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** The log, re-rendering when it changes (also from another tab). */
export function useHandoffLog(): HandoffLogEntry[] {
  return useSyncExternalStore(subscribe, readHandoffLog, readHandoffLog);
}

/** Test helper. */
export function resetHandoffLogCache(): void {
  cache = null;
}
