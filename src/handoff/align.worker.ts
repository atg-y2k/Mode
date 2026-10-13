/// <reference lib="webworker" />
/**
 * Alignment worker: runs the import pipeline (ORB + RANSAC alignment with
 * OpenCV.js, colour fit, composite, change map) off the main thread.
 *
 * OpenCV.js is imported statically here — the worker itself is only created
 * on demand (first hand-off), so the 13 MB script is still lazy for the app,
 * and a static import keeps the worker a single bundle. Initialization
 * starts as soon as the worker boots; if it fails, imports still work with
 * the plain crop/scale mapping (aligned: false).
 */
import * as cvNamespace from '@techstark/opencv-js';
import { resolveOpenCv, type CvLike } from './cv';
import { runImport, type ImportJob, type ImportStage } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

declare const self: DedicatedWorkerGlobalScope;

let cvError = '';
const cvReady: Promise<CvLike | null> = resolveOpenCv(cvNamespace).catch((err: unknown) => {
  cvError = (err as Error)?.message ?? String(err);
  return null;
});

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'warmup') {
    await cvReady;
    post({ type: 'ready', id: msg.id, opencv: !cvError });
    return;
  }
  const { id } = msg;
  try {
    post({ type: 'stage', id, stage: 'loading' });
    const cv = await cvReady;
    const job: ImportJob = msg.job;
    const result = runImport(cv, job, (stage: ImportStage) => post({ type: 'stage', id, stage }));
    if (!cv && cvError && result.alignNote) result.alignNote = `${result.alignNote} (OpenCV: ${cvError})`;
    post({ type: 'done', id, result }, [result.composite.data.buffer as ArrayBuffer, result.outsideChangeMap.data.buffer as ArrayBuffer]);
  } catch (err) {
    post({ type: 'error', id, message: (err as Error)?.message ?? String(err) });
  }
};
