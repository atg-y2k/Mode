/// <reference lib="webworker" />
/**
 * Export worker: crop / snap / resize / marker (renderHandoff) and the JPEG
 * + PNG encodes, off the main thread. Small — no OpenCV here. When the
 * worker has no OffscreenCanvas, the pixels come back and the main thread
 * encodes them.
 */
import { canvasResizer, encodeOffscreen } from './canvasResize';
import { renderHandoff } from './prepare';
import type { PrepareRequest, PrepareResponse } from './workerProtocol';

declare const self: DedicatedWorkerGlobalScope;

const CLEAN_QUALITY = 0.92;

self.onmessage = async (event: MessageEvent<PrepareRequest>) => {
  const { id, image, target, opts } = event.data;
  try {
    const r = renderHandoff(image, target, { ...opts, resize: canvasResizer() });
    const [clean, marked] = await Promise.all([encodeOffscreen(r.clean, 'image/jpeg', CLEAN_QUALITY), encodeOffscreen(r.marked, 'image/png')]);
    const { clean: cleanPx, marked: markedPx, ...meta } = r;
    const msg: PrepareResponse =
      clean && marked
        ? { type: 'done', id, result: { ...meta, clean, marked } }
        : { type: 'done', id, result: { ...meta, cleanPixels: cleanPx, markedPixels: markedPx } };
    const transfer: Transferable[] = clean && marked ? [] : [cleanPx.data.buffer as ArrayBuffer, markedPx.data.buffer as ArrayBuffer];
    self.postMessage(msg, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err as Error)?.message ?? String(err) } satisfies PrepareResponse);
  }
};
