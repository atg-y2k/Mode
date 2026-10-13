/**
 * Free in-browser vision (Transformers.js in a Web Worker, WebGPU when
 * available, else WASM) that makes the scene map precise without paid AI:
 * - EdgeTAM (onnx-community/EdgeTAM-ONNX, Apache-2.0): box + point prompts → exact masks;
 * - SegFormer-B2 ADE20K (Xenova/segformer-b2-finetuned-ade-512-512; NVIDIA
 *   non-commercial license — fine for personal use, flagged in the UI) for
 *   semantic validation and an offline scene map when Claude is not configured;
 * - CLIPSeg (Xenova/clipseg-rd64-refined, Apache-2.0) for classes ADE20K lacks
 *   (roof, driveway, mulch bed, patio).
 * Models download on first use (progress reported) and are cached by the browser.
 *
 * This module is the main-thread client: it owns the worker (created lazily
 * on first use, so importing it is free), sends each photo's pixels once,
 * and turns worker results into store-ready masks, polygons and scene maps.
 */
import type { Pt, SceneMap, SceneZone, ZoneKind } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';
import { getPhotoImage } from '../state/runtime';
import { largestContour } from './contours';
import { formatMB, MODELS, modelBytes, TASK_MODELS, type Backend, type ModelKey, type VisionTask } from './models';
import type { InitResult, OfflineMapResult, PromptInput, RefineZoneResult, SegmentResult, WorkerMessage, WorkerRequest, WorkerStatus } from './protocol';
import { buildOfflineScene } from './sceneFromClasses';

export type VisionStage = 'idle' | 'downloading' | 'encoding' | 'ready' | 'error';

export interface VisionStatus {
  stage: VisionStage;
  /** 0..1 while downloading. */
  progress?: number;
  backend?: 'webgpu' | 'wasm';
  message?: string;
  /** Bytes downloaded / to download while downloading. */
  loadedBytes?: number;
  totalBytes?: number;
}

/** Error from the vision layer; `code` tells the UI which fallback to offer. */
export class VisionError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'network' | 'memory' | 'no-image' | 'cancelled' | 'crashed' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'VisionError';
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

let status: VisionStatus = { stage: 'idle' };
const listeners = new Set<(s: VisionStatus) => void>();

function emit(next: VisionStatus): void {
  status = next;
  for (const l of [...listeners]) l(status);
}

export function getVisionStatus(): VisionStatus {
  return status;
}

export function onVisionStatus(listener: (s: VisionStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Worker & RPC
// ---------------------------------------------------------------------------

type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  onProgress?: (done: number, total: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let initPromise: Promise<InitResult> | null = null;
let device: InitResult | null = null;

/** Why on-device vision cannot run here, or null when it can. */
export function visionUnsupportedReason(): string | null {
  if (typeof Worker === 'undefined') return 'This browser cannot run background workers, so on-device vision is unavailable.';
  if (typeof WebAssembly === 'undefined') return 'WebAssembly is turned off in this browser, so on-device vision is unavailable.';
  return null;
}

function failAll(err: VisionError): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function onMessage(e: MessageEvent<WorkerMessage>): void {
  const msg = e.data;
  if (msg.type === 'status') {
    const s: WorkerStatus = msg.status;
    emit({ ...s });
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  if (msg.type === 'progress') {
    p.onProgress?.(msg.done, msg.total);
    return;
  }
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.data);
  else p.reject(new VisionError(msg.error, msg.code ?? 'failed'));
}

function getWorker(): Worker {
  if (worker) return worker;
  const problem = visionUnsupportedReason();
  if (problem) throw new VisionError(problem, 'unsupported');
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'mode-vision' });
  w.addEventListener('message', onMessage);
  w.addEventListener('error', (e) => {
    // Script failed to load or the worker crashed (often out of memory).
    e.preventDefault?.();
    if (worker === w) worker = null;
    initPromise = null;
    sentImages.clear();
    sending.clear();
    w.terminate();
    const err = new VisionError('On-device vision stopped unexpectedly (the device may be low on memory). Try again.', 'crashed');
    failAll(err);
    emit({ stage: 'error', message: err.message, backend: device?.backend });
  });
  worker = w;
  return w;
}

function call<T>(req: Request, transfer: Transferable[] = [], onProgress?: (done: number, total: number) => void): Promise<T> {
  let w: Worker;
  try {
    w = getWorker();
  } catch (err) {
    return Promise.reject(err);
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    w.postMessage({ ...req, id } as WorkerRequest, transfer);
  });
}

function readPreference(): 'auto' | 'wasm' {
  try {
    return globalThis.localStorage?.getItem('mode.vision.backend') === 'wasm' ? 'wasm' : 'auto';
  } catch {
    return 'auto';
  }
}

/** Starts the worker and picks the backend (WebGPU when an adapter is available). */
export function initVision(): Promise<InitResult> {
  if (!initPromise) {
    initPromise = call<InitResult>({ op: 'init', prefer: readPreference() }).then(
      (r) => {
        device = r;
        if (status.stage === 'idle') emit({ ...status, backend: r.backend });
        return r;
      },
      (err) => {
        initPromise = null;
        if (err instanceof VisionError && err.code === 'unsupported') emit({ stage: 'error', message: err.message });
        throw err;
      },
    );
  }
  return initPromise;
}

/** The backend in use, once known. */
export function visionBackend(): { backend: Backend; f16: boolean } | null {
  return device ? { backend: device.backend, f16: device.f16 } : null;
}

/**
 * Stops whatever the models are doing (terminates the worker). Pending calls
 * reject with code 'cancelled'; models reload from the browser cache next time.
 */
export function cancelVision(): void {
  const w = worker;
  worker = null;
  initPromise = null;
  sentImages.clear();
  sending.clear();
  w?.terminate();
  failAll(new VisionError('Cancelled', 'cancelled'));
  emit({ stage: 'idle', backend: device?.backend });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Photo pixels the worker has (by reference — the runtime's decoded image). */
const sentImages = new Map<string, ImageDataLike>();
const knownImages = new Map<string, ImageDataLike>();

function remember(photoId: string, image: ImageDataLike): void {
  knownImages.delete(photoId);
  knownImages.set(photoId, image);
  while (knownImages.size > 4) knownImages.delete(knownImages.keys().next().value as string);
}

/** Sends in flight, so concurrent calls (a click and a hover) send a photo once. */
const sending = new Map<string, { image: ImageDataLike; done: Promise<void> }>();

function sendImage(photoId: string, image: ImageDataLike): Promise<void> {
  const inflight = sending.get(photoId);
  if (inflight?.image === image) return inflight.done;
  // Copy: the worker takes ownership of the buffer, the runtime keeps its own.
  const data = new Uint8ClampedArray(image.data);
  const done = call<boolean>({ op: 'setImage', photoId, width: image.width, height: image.height, data }, [data.buffer])
    .then(() => {
      sentImages.set(photoId, image);
    })
    .finally(() => {
      if (sending.get(photoId)?.done === done) sending.delete(photoId);
    });
  sending.set(photoId, { image, done });
  return done;
}

async function ensureImage(photoId: string, image?: ImageDataLike): Promise<void> {
  await initVision();
  const img = image ?? knownImages.get(photoId) ?? getPhotoImage(photoId);
  if (!img) throw new VisionError('Load the photo first.', 'no-image');
  remember(photoId, img);
  if (sentImages.get(photoId) !== img) await sendImage(photoId, img);
}

/** Calls an op that needs the photo; resends the pixels once if the worker evicted them. */
async function withImage<T>(photoId: string, image: ImageDataLike | undefined, run: () => Promise<T>): Promise<T> {
  await ensureImage(photoId, image);
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof VisionError) || err.code !== 'no-image') throw err;
    sentImages.delete(photoId);
    await ensureImage(photoId, image);
    return run();
  }
}

/** Drops a photo's cached pixels and embeddings in the worker. */
export function forgetVision(photoId: string): void {
  knownImages.delete(photoId);
  if (!sentImages.delete(photoId) || !worker) return;
  void call({ op: 'forget', photoId }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** Encodes the photo once (EdgeTAM image embedding); later prompts take ~0.1 s. */
export async function prepareVision(photoId: string, image: ImageDataLike): Promise<void> {
  await withImage(photoId, image, () => call<boolean>({ op: 'encode', photoId }));
}

function toPrompt(prompt: { positive: Pt[]; negative?: Pt[]; box?: { x: number; y: number; w: number; h: number } }): PromptInput {
  const clean = (pts: Pt[] | undefined) => (pts ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }));
  return { positive: clean(prompt.positive), negative: clean(prompt.negative), box: prompt.box ? { ...prompt.box } : undefined };
}

/** Mask for a click (positive points) plus optional negative points and a box, at photo size. */
export async function segmentAt(
  photoId: string,
  prompt: { positive: Pt[]; negative?: Pt[]; box?: { x: number; y: number; w: number; h: number } },
): Promise<Mask> {
  return (await segmentClick(photoId, prompt)).mask;
}

export interface ClickSegment {
  mask: Mask;
  /** Decoder's predicted IoU of the chosen candidate. */
  score: number;
  /** The chosen candidate's position by size (0 = smallest) out of `ranks` — for "Smaller / Larger". */
  rank: number;
  ranks: number;
  /** Decoder time in ms. */
  ms: number;
}

/**
 * segmentAt with the candidate choice exposed: `rank` picks a candidate by
 * size (default: the decoder's best, preferring a more specific one when it
 * scores about as well); `maxSize` returns a low-resolution mask (long edge)
 * for hover previews. Re-picking a rank of the last prompt is instant.
 */
export async function segmentClick(
  photoId: string,
  prompt: { positive: Pt[]; negative?: Pt[]; box?: { x: number; y: number; w: number; h: number } },
  opts: { rank?: number; maxSize?: number } = {},
): Promise<ClickSegment> {
  const r = await withImage(photoId, undefined, () =>
    call<SegmentResult>({ op: 'segment', photoId, prompt: toPrompt(prompt), maxSize: opts.maxSize, rank: opts.rank }),
  );
  return { mask: { width: r.width, height: r.height, data: r.mask }, score: r.score, rank: r.rank, ranks: r.ranks, ms: r.ms };
}

export interface RefineDetail {
  /** False = kept the AI outline (no candidate matched it well enough). */
  refined: boolean;
  mask?: Mask;
  polygon?: Pt[];
  /** 0..1 agreement between the sharpened mask, the AI outline and the semantic classes. */
  agreement: number;
  iou: number;
  classShare: number | null;
}

/**
 * refineZones with every zone's outcome (also the ones that kept their
 * outline). `context` = all zones of the scene, used for negative clicks
 * (defaults to `zones`).
 */
export async function refineZonesDetailed(
  photoId: string,
  image: ImageDataLike,
  zones: SceneZone[],
  opts: { context?: SceneZone[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, RefineDetail>> {
  const usable = zones.filter((z) => z.polygon.length >= 3);
  const out = new Map<string, RefineDetail>();
  if (usable.length === 0) return out;
  const strip = (z: SceneZone) => ({ id: z.id, kind: z.kind, polygon: z.polygon.map((p) => ({ x: p.x, y: p.y })) });
  const context = (opts.context ?? zones).filter((z) => z.polygon.length >= 3).map(strip);
  const results = await withImage(photoId, image, () =>
    call<RefineZoneResult[]>({ op: 'refine', photoId, zones: usable.map(strip), context }, [], opts.onProgress),
  );
  for (const r of results) {
    out.set(r.zoneId, {
      refined: r.refined && !!r.mask && !!r.polygon,
      mask: r.mask ? { width: image.width, height: image.height, data: r.mask } : undefined,
      polygon: r.polygon,
      agreement: r.agreement,
      iou: r.iou,
      classShare: r.classShare,
    });
  }
  return out;
}

/**
 * Refines AI zone polygons into exact masks: per zone a box + 2–5 positive
 * points inside the shrunk polygon + negatives in neighbouring zones; of the
 * candidate masks keep the one that best overlaps the polygon (IoU) and agrees
 * with ADE20K classes. Returns masks keyed by zone id plus simplified polygons.
 * Zones whose outline no candidate matched are left out (keep their polygon).
 */
export async function refineZones(
  photoId: string,
  image: ImageDataLike,
  zones: SceneZone[],
  onProgress?: (done: number, total: number) => void,
  context?: SceneZone[],
): Promise<Map<string, { mask: Mask; polygon: Pt[]; agreement: number }>> {
  const detailed = await refineZonesDetailed(photoId, image, zones, { onProgress, context });
  const out = new Map<string, { mask: Mask; polygon: Pt[]; agreement: number }>();
  for (const [id, d] of detailed) if (d.refined && d.mask && d.polygon) out.set(id, { mask: d.mask, polygon: d.polygon, agreement: d.agreement });
  return out;
}

/**
 * Offline scene map from semantic segmentation (no Claude): zones for lawn,
 * planting beds/plants, trees, paths/sidewalk, driveway/road, house/building,
 * roof (CLIPSeg), door, windows, fence, sky; interiors: wall, floor, ceiling,
 * cabinets, countertop, windows. Category guessed from the class mix.
 */
export async function offlineSceneMap(photoId: string, image: ImageDataLike, interior: boolean): Promise<SceneMap> {
  const r = await withImage(photoId, image, () => call<OfflineMapResult>({ op: 'offlineMap', photoId, interior }));
  return buildOfflineScene(r.zones, r.category, r.usedClip);
}

/** Mask → simplified clockwise polygon (largest component), in photo px. */
export function maskToPolygon(mask: Mask, tolerancePx?: number): Pt[] {
  const tol = tolerancePx ?? Math.max(1.5, Math.max(mask.width, mask.height) * 0.0015);
  return largestContour(mask, { tolerancePx: tol });
}

// ---------------------------------------------------------------------------
// Extras for the UI
// ---------------------------------------------------------------------------

/**
 * Zone kind of what a mask covers, from the semantic map when it was already
 * computed for this photo (sharpen / offline map) — never runs a model.
 */
export async function guessZoneKind(photoId: string, mask: Mask, interior: boolean): Promise<ZoneKind | null> {
  if (!worker || !sentImages.has(photoId)) return null;
  try {
    const data = new Uint8Array(mask.data);
    return await call<ZoneKind | null>({ op: 'kindOf', photoId, mask: data, width: mask.width, height: mask.height, interior }, [data.buffer]);
  } catch {
    return null;
  }
}

/** Which of the models are already in the browser cache (no download needed). */
export async function cachedModels(keys: readonly ModelKey[]): Promise<Partial<Record<ModelKey, boolean>>> {
  try {
    await initVision();
    return await call<Partial<Record<ModelKey, boolean>>>({ op: 'cached', models: [...keys] });
  } catch {
    return {};
  }
}

/** Models a task needs with their download sizes on the detected (or assumed) backend. */
export function taskDownload(task: VisionTask, skip: Partial<Record<ModelKey, boolean>> = {}): { bytes: number; label: string; models: { key: ModelKey; name: string; bytes: number }[] } {
  const backend = device?.backend ?? 'wasm';
  const f16 = device?.f16 ?? false;
  const models = TASK_MODELS[task].filter((k) => !skip[k]).map((key) => ({ key, name: MODELS[key].name, bytes: modelBytes(key, backend, f16) }));
  const bytes = models.reduce((s, m) => s + m.bytes, 0);
  return { bytes, label: formatMB(bytes), models };
}

export { MODELS, formatMB } from './models';
export type { ModelKey, VisionTask } from './models';
