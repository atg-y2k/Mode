/**
 * Runs import jobs in the alignment worker (one shared worker, created on
 * first use), falling back to the main thread when Workers are unavailable
 * or the worker fails to start. Inputs are copied before transfer so the
 * caller's cached pixels stay intact.
 */
import { loadOpenCv, type CvLike } from './cv';
import { runImport, type ImportJob, type ImportResult } from './pipeline';
import type { WorkerRequest, WorkerResponse, WorkerStage } from './workerProtocol';

/** Longest we wait for a worker job before giving up on the worker (first run includes loading OpenCV). */
const WORKER_TIMEOUT_MS = 120_000;
/** Longest the main-thread fallback waits for OpenCV before aligning without it. */
const MAIN_THREAD_CV_TIMEOUT_MS = 60_000;

export type ImportProgress = WorkerStage;

class WorkerUnavailable extends Error {}

interface Pending {
  resolve: (r: ImportResult) => void;
  reject: (e: Error) => void;
  onStage?: (stage: ImportProgress) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

function dropWorker(reason: string): void {
  workerBroken = true;
  try {
    worker?.terminate();
  } catch {
    // ignore
  }
  worker = null;
  failAll(new WorkerUnavailable(reason));
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module', name: 'mode-align' });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'stage') {
      p.onStage?.(msg.stage);
      return;
    }
    clearTimeout(p.timer);
    pending.delete(msg.id);
    if (msg.type === 'done') p.resolve(msg.result);
    else if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(undefined as unknown as ImportResult); // 'ready' (warm-up)
  };
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault?.();
    dropWorker(event.message || 'The alignment worker failed to start.');
  };
  worker.onmessageerror = () => dropWorker('The alignment worker could not read a message.');
  return worker;
}

function post(
  w: Worker,
  msg: WorkerRequest,
  transfer: Transferable[],
  onStage?: (s: ImportProgress) => void,
  timeoutMs = WORKER_TIMEOUT_MS,
): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(msg.id)) dropWorker('The alignment worker timed out.');
    }, timeoutMs);
    pending.set(msg.id, { resolve, reject, onStage, timer });
    try {
      w.postMessage(msg, transfer);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(msg.id);
      reject(new WorkerUnavailable((err as Error)?.message ?? 'postMessage failed'));
    }
  });
}

function abortError(): Error {
  return typeof DOMException !== 'undefined' ? new DOMException('The import was cancelled.', 'AbortError') : new Error('The import was cancelled.');
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Copies the job's buffers (the caller keeps its own) and lists them for transfer. */
function transferableCopy(job: ImportJob): { job: ImportJob; transfer: Transferable[] } {
  const original = { width: job.original.width, height: job.original.height, data: new Uint8ClampedArray(job.original.data) };
  const target = { width: job.target.width, height: job.target.height, data: new Uint8Array(job.target.data) };
  const returned = { width: job.returned.width, height: job.returned.height, data: new Uint8ClampedArray(job.returned.data) };
  return {
    job: { ...job, original, target, returned },
    transfer: [original.data.buffer, target.data.buffer, returned.data.buffer],
  };
}

async function cvOnMainThread(): Promise<CvLike | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), MAIN_THREAD_CV_TIMEOUT_MS);
  });
  try {
    return await Promise.race([loadOpenCv().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function onMainThread(job: ImportJob, signal?: AbortSignal, onStage?: (s: ImportProgress) => void): Promise<ImportResult> {
  onStage?.('loading');
  const cv = await withAbort(cvOnMainThread(), signal);
  if (signal?.aborted) throw abortError();
  // Let the UI paint the progress message before the synchronous work.
  await new Promise((r) => setTimeout(r, 0));
  return runImport(cv, job, onStage);
}

/** Runs an import job (worker first, main thread as a fallback). */
export async function runImportJob(job: ImportJob, signal?: AbortSignal, onStage?: (s: ImportProgress) => void): Promise<ImportResult> {
  if (signal?.aborted) throw abortError();
  const w = getWorker();
  if (w) {
    const { job: copy, transfer } = transferableCopy(job);
    try {
      return await withAbort(post(w, { type: 'import', id: ++seq, job: copy }, transfer, onStage), signal);
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
      // Fall through: run it here instead.
    }
  }
  return onMainThread(job, signal, onStage);
}

/**
 * Starts the alignment worker and OpenCV.js in the background (call when a
 * hand-off is opened, so the import is instant when the user comes back).
 */
export function warmUpAlignment(): void {
  const w = getWorker();
  if (!w) return;
  // No timeout: a slow first download must not cost us the worker.
  void post(w, { type: 'warmup', id: ++seq }, [], undefined, 2 ** 31 - 1).catch(() => undefined);
}
