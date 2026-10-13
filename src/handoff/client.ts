/**
 * Runs hand-off jobs in workers — the export (prepare.worker.ts, small) and
 * the import alignment (align.worker.ts, with OpenCV.js) — each created on
 * first use and shared, falling back to the main thread when Workers are
 * unavailable or a worker fails to start. Inputs are copied before transfer
 * so the caller's cached pixels stay intact.
 */
import type { ImageDataLike, Mask } from '../engine/types';
import { canvasResizer } from './canvasResize';
import { loadOpenCv, type CvLike } from './cv';
import { runImport, type ImportJob, type ImportResult } from './pipeline';
import { renderHandoff, type RenderOptions } from './prepare';
import type { PrepareRequest, PreparedTransfer, WorkerRequest, WorkerStage } from './workerProtocol';

/** Longest we wait for an import before giving up on the worker (the first run includes loading OpenCV). */
const IMPORT_TIMEOUT_MS = 120_000;
const PREPARE_TIMEOUT_MS = 60_000;
/** Longest the main-thread fallback waits for OpenCV before aligning without it. */
const MAIN_THREAD_CV_TIMEOUT_MS = 60_000;
const NO_TIMEOUT = 2 ** 31 - 1;

export type ImportProgress = WorkerStage;

/** The worker could not run the job (not created, crashed, timed out): run it on the main thread instead. */
class WorkerUnavailable extends Error {}

type Message = { type: string; id: number };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (e: Error) => void;
  onStage?: (stage: ImportProgress) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One lazily created worker with request/response bookkeeping. */
class JobWorker {
  private worker: Worker | null = null;
  private broken = false;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor(private readonly create: () => Worker) {}

  get available(): boolean {
    return !this.broken && typeof Worker !== 'undefined';
  }

  private fail(reason: string): void {
    this.broken = true;
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new WorkerUnavailable(reason));
      this.pending.delete(id);
    }
  }

  private get(): Worker | null {
    if (!this.available) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.create();
    } catch {
      this.broken = true;
      return null;
    }
    this.worker.onmessage = (event: MessageEvent<Message & { stage?: ImportProgress; result?: unknown; message?: string }>) => {
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'stage') {
        if (msg.stage) p.onStage?.(msg.stage);
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message || 'The worker failed.'));
      else p.resolve(msg.result);
    };
    this.worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.();
      this.fail(event.message || 'A hand-off worker failed to start.');
    };
    this.worker.onmessageerror = () => this.fail('A hand-off worker could not read a message.');
    return this.worker;
  }

  /** Posts `build(id)`; rejects with WorkerUnavailable when the worker can't be used. */
  run<T>(build: (id: number) => Message, transfer: Transferable[], timeoutMs: number, onStage?: (s: ImportProgress) => void): Promise<T> {
    const w = this.get();
    if (!w) return Promise.reject(new WorkerUnavailable('Workers are not available.'));
    const msg = build(++this.seq);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(msg.id)) this.fail('A hand-off worker timed out.');
      }, timeoutMs);
      this.pending.set(msg.id, { resolve: resolve as (v: unknown) => void, reject, onStage, timer });
      try {
        w.postMessage(msg, transfer);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(msg.id);
        reject(new WorkerUnavailable((err as Error)?.message ?? 'postMessage failed'));
      }
    });
  }
}

const alignWorker = new JobWorker(() => new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module', name: 'mode-align' }));
const prepareWorker = new JobWorker(() => new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module', name: 'mode-export' }));

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

function copyImage(img: ImageDataLike): ImageDataLike {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

function copyMask(m: Mask): Mask {
  return { width: m.width, height: m.height, data: new Uint8Array(m.data) };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

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

async function importOnMainThread(job: ImportJob, signal?: AbortSignal, onStage?: (s: ImportProgress) => void): Promise<ImportResult> {
  onStage?.('loading');
  const cv = await withAbort(cvOnMainThread(), signal);
  if (signal?.aborted) throw abortError();
  // Let the UI paint its progress message before the synchronous work.
  await new Promise((r) => setTimeout(r, 0));
  return runImport(cv, job, onStage);
}

/** Runs an import job (worker first, main thread as a fallback). */
export async function runImportJob(job: ImportJob, signal?: AbortSignal, onStage?: (s: ImportProgress) => void): Promise<ImportResult> {
  if (signal?.aborted) throw abortError();
  if (alignWorker.available) {
    const copy: ImportJob = { ...job, original: copyImage(job.original), target: copyMask(job.target), returned: copyImage(job.returned) };
    const transfer = [copy.original.data.buffer, copy.target.data.buffer, copy.returned.data.buffer] as Transferable[];
    try {
      return await withAbort(
        alignWorker.run<ImportResult>((id) => ({ type: 'import', id, job: copy }) satisfies WorkerRequest, transfer, IMPORT_TIMEOUT_MS, onStage),
        signal,
      );
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
    }
  }
  return importOnMainThread(job, signal, onStage);
}

/**
 * Starts the alignment worker and OpenCV.js in the background (called when
 * a hand-off is prepared, so the import is quick when the user comes back).
 */
export function warmUpAlignment(): void {
  if (!alignWorker.available) return;
  // No timeout: a slow first download must not cost us the worker.
  alignWorker.run((id) => ({ type: 'warmup', id }) satisfies WorkerRequest, [], NO_TIMEOUT).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

/** Renders an export (worker first, main thread as a fallback). Blobs are encoded when the worker could. */
export async function runPrepareJob(image: ImageDataLike, target: Mask, opts: Omit<RenderOptions, 'resize'>): Promise<PreparedTransfer> {
  if (prepareWorker.available) {
    const img = copyImage(image);
    const mask = copyMask(target);
    try {
      return await prepareWorker.run<PreparedTransfer>(
        (id) => ({ type: 'prepare', id, image: img, target: mask, opts }) satisfies PrepareRequest,
        [img.data.buffer, mask.data.buffer] as Transferable[],
        PREPARE_TIMEOUT_MS,
      );
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw err;
    }
  }
  const r = renderHandoff(image, target, { ...opts, resize: canvasResizer() });
  const { clean, marked, ...meta } = r;
  return { ...meta, cleanPixels: clean, markedPixels: marked };
}

