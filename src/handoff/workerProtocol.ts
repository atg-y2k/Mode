/** Messages between the main thread and align.worker.ts. */
import type { ImportJob, ImportResult, ImportStage } from './pipeline';

export type WorkerRequest = { type: 'import'; id: number; job: ImportJob } | { type: 'warmup'; id: number };

export type WorkerStage = ImportStage | 'loading';

export type WorkerResponse =
  | { type: 'stage'; id: number; stage: WorkerStage }
  | { type: 'done'; id: number; result: ImportResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'ready'; id: number; opencv: boolean };
