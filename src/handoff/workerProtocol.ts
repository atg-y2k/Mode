/** Messages between the main thread and the hand-off workers (align.worker.ts, prepare.worker.ts). */
import type { ImageDataLike, Mask } from '../engine/types';
import type { ImportJob, ImportResult, ImportStage } from './pipeline';
import type { RenderOptions, RenderedHandoff } from './prepare';

export type WorkerRequest = { type: 'import'; id: number; job: ImportJob } | { type: 'warmup'; id: number };

export type WorkerStage = ImportStage | 'loading';

export type WorkerResponse =
  | { type: 'stage'; id: number; stage: WorkerStage }
  | { type: 'done'; id: number; result: ImportResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'ready'; id: number; opencv: boolean };

export interface PrepareRequest {
  type: 'prepare';
  id: number;
  image: ImageDataLike;
  target: Mask;
  opts: Omit<RenderOptions, 'resize'>;
}

/** Export metadata plus either encoded blobs (worker had OffscreenCanvas) or the raw pixels to encode. */
export type PreparedTransfer = Omit<RenderedHandoff, 'clean' | 'marked'> &
  ({ clean: Blob; marked: Blob } | { cleanPixels: ImageDataLike; markedPixels: ImageDataLike });

export type PrepareResponse = { type: 'done'; id: number; result: PreparedTransfer } | { type: 'error'; id: number; message: string };
