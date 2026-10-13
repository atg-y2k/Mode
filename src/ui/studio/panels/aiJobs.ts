/**
 * Long-running AI calls started from the Studio panels (suggestions, tailored
 * options, climate lookup, idea descriptions, product search…). Jobs live
 * outside React so they survive switching panel tabs; the UI subscribes by
 * key to show progress (with elapsed time and Cancel) and errors (with
 * Retry). One job per key: starting a key again cancels the previous run.
 * Every job is cancelled when the open project changes.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../../../state/store';
import { friendlyAiError } from './aiErrors';

export interface AiJob {
  key: string;
  /** Present-tense description shown while running ("Reading your photo…"). */
  label: string;
  startedAt: number;
  status: 'running' | 'error' | 'done';
  error?: string;
  /** Extra lines from a finished job (e.g. tips returned with tailored options). */
  info?: string[];
}

interface AiJobsState {
  jobs: Record<string, AiJob>;
}

export const useAiJobs = create<AiJobsState>()(() => ({ jobs: {} }));

const controllers = new Map<string, AbortController>();
let watchingProject = false;

function setJob(key: string, job: AiJob | null): void {
  useAiJobs.setState((s) => {
    const jobs = { ...s.jobs };
    if (job) jobs[key] = job;
    else delete jobs[key];
    return { jobs };
  });
}

function watchProject(): void {
  if (watchingProject) return;
  watchingProject = true;
  let projectId = useStore.getState().project?.id ?? null;
  useStore.subscribe((s) => {
    const id = s.project?.id ?? null;
    if (id === projectId) return;
    projectId = id;
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    useAiJobs.setState({ jobs: {} });
  });
}

export function useAiJob(key: string | null | undefined): AiJob | undefined {
  return useAiJobs((s) => (key ? s.jobs[key] : undefined));
}

/** True while any job whose key starts with `prefix` runs. */
export function useAiJobPrefixRunning(prefix: string): boolean {
  return useAiJobs((s) => Object.values(s.jobs).some((j) => j.status === 'running' && j.key.startsWith(prefix)));
}

export function isAiJobRunning(key: string): boolean {
  return useAiJobs.getState().jobs[key]?.status === 'running';
}

export interface RunAiJobOptions<T> {
  /** Shown while running. */
  label: string;
  /** Action in "Couldn't {what}" error messages, e.g. "get suggestions". */
  what: string;
  /** Also show failures as a toast (for jobs whose UI may be off screen); a function decides at failure time. */
  toastErrors?: boolean | (() => boolean);
  /** Lines to keep on the finished job (shown by the panel). Without it, a finished job is cleared. */
  info?: (result: T) => string[] | undefined;
}

/**
 * Runs `fn` as job `key`. Resolves with its result, or undefined when it was
 * cancelled or failed (the friendly error stays on the job until cleared or
 * re-run). `fn` must check `signal.aborted` before applying results that
 * arrive after the user moved on.
 */
export async function runAiJob<T>(key: string, fn: (signal: AbortSignal) => Promise<T>, opts: RunAiJobOptions<T>): Promise<T | undefined> {
  watchProject();
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  setJob(key, { key, label: opts.label, startedAt: Date.now(), status: 'running' });
  try {
    const result = await fn(controller.signal);
    if (controller.signal.aborted) return undefined;
    const info = opts.info?.(result);
    setJob(key, info && info.length ? { key, label: opts.label, startedAt: Date.now(), status: 'done', info } : null);
    return result;
  } catch (err) {
    if (controller.signal.aborted) return undefined;
    const message = friendlyAiError(err, opts.what);
    if (message === null) {
      setJob(key, null);
      return undefined;
    }
    setJob(key, { key, label: opts.label, startedAt: Date.now(), status: 'error', error: message });
    const toast = typeof opts.toastErrors === 'function' ? opts.toastErrors() : opts.toastErrors;
    if (toast) useStore.getState().notify(message, 'error');
    return undefined;
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key);
  }
}

export function cancelAiJob(key: string): void {
  const c = controllers.get(key);
  if (c) {
    c.abort();
    controllers.delete(key);
  }
  setJob(key, null);
}

export function clearAiJob(key: string): void {
  if (useAiJobs.getState().jobs[key]?.status !== 'running') setJob(key, null);
}

/** Milliseconds since `startedAt`, re-rendering every second while `active`. */
export function useElapsed(startedAt: number | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, startedAt]);
  return startedAt ? Math.max(0, now - startedAt) : 0;
}
