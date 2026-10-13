/**
 * Vision worker: runs the on-device models with Transformers.js so the UI
 * thread never stalls.
 *
 * - Backend: WebGPU when an adapter is available (fp16 with shader-f16), else
 *   WebAssembly (multi-threaded only when the page is cross-origin isolated).
 *   A model that fails on WebGPU is reloaded on WASM once.
 * - Models download from the Hugging Face Hub on first use and are kept in
 *   the browser's Cache API (Transformers.js `useBrowserCache`); the ONNX
 *   Runtime WASM binaries are served by Mode itself (no CDN).
 * - Per photo it caches the RGB image, the EdgeTAM image embedding (so each
 *   click only runs the ~10–70 ms decoder) and the ADE20K class map.
 */
import {
  AutoImageProcessor,
  AutoProcessor,
  AutoTokenizer,
  CLIPSegForImageSegmentation,
  EdgeTamModel,
  LogLevel,
  ModelRegistry,
  RawImage,
  SegformerForSemanticSegmentation,
  Tensor,
  env,
  type ProgressInfo,
} from '@huggingface/transformers';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { growMask } from '../engine/mask';
import type { Mask } from '../engine/types';
import { classesForZone, zoneKindForClass } from './ade20k';
import { largestContour } from './contours';
import { MODELS, dtypeFor, modelBytes, type Backend, type ModelKey } from './models';
import type {
  InitResult,
  OfflineMapResult,
  PromptInput,
  RefineZoneInput,
  RefineZoneResult,
  SegmentResult,
  WorkerMessage,
  WorkerRequest,
  WorkerStatus,
} from './protocol';
import { zonePrompt } from './prompts';
import { analysisSize, logitsToCoverage, logitsToLabels, logitsToProbs } from './resample';
import { CLIP_PROMPTS, offlineCategory, zonesFromClasses, type ClipKey, type ClipMaps } from './sceneFromClasses';
import {
  MIN_REFINE_IOU,
  candidateScore,
  classAgreement,
  cleanMask,
  clipMarginFor,
  maskIoU,
  rasterizePolygon,
  zoneAgreement,
  type ClassMap,
} from './scoring';

// ---------------------------------------------------------------------------
// Worker plumbing (typed without the WebWorker lib, which clashes with DOM)
// ---------------------------------------------------------------------------

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequest>) => void): void;
}
const scope = self as unknown as WorkerScope;

function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

let status: WorkerStatus = { stage: 'idle' };
function setStatus(next: WorkerStatus): void {
  status = next;
  post({ type: 'status', status });
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.logLevel = LogLevel.ERROR;
const onnxWasm = env.backends.onnx.wasm;
if (onnxWasm) {
  onnxWasm.wasmPaths = { mjs: new URL(ortMjsUrl, self.location.href).href, wasm: new URL(ortWasmUrl, self.location.href).href };
  // Threads need SharedArrayBuffer (cross-origin isolated pages only).
  onnxWasm.numThreads = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
}

interface GpuLike {
  requestAdapter(opts?: { powerPreference?: string }): Promise<{ features: { has(name: string): boolean } } | null>;
}

let device: { backend: Backend; f16: boolean } | null = null;

async function detectDevice(prefer: 'auto' | 'wasm'): Promise<{ backend: Backend; f16: boolean }> {
  if (prefer === 'wasm') return { backend: 'wasm', f16: false };
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) return { backend: 'wasm', f16: false };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { backend: 'wasm', f16: false };
    return { backend: 'webgpu', f16: adapter.features.has('shader-f16') };
  } catch {
    return { backend: 'wasm', f16: false };
  }
}

// ---------------------------------------------------------------------------
// Download progress across files and models
// ---------------------------------------------------------------------------

const fileProgress = new Map<string, { loaded: number; total: number }>();
/** Expected bytes per model being loaded (until the real file sizes are known). */
const expected = new Map<ModelKey, number>();

function reportDownload(model: ModelKey | null, info?: ProgressInfo): void {
  if (info && info.status === 'progress' && model) {
    fileProgress.set(`${model}/${info.file}`, { loaded: info.loaded, total: info.total });
  }
  let loaded = 0;
  let total = 0;
  for (const [key, bytes] of expected) {
    let known = 0;
    let got = 0;
    for (const [file, p] of fileProgress) {
      if (!file.startsWith(`${key}/`)) continue;
      known += p.total;
      got += Math.min(p.loaded, p.total);
    }
    total += Math.max(bytes, known);
    loaded += got;
  }
  if (total <= 0) return;
  const names = [...expected.keys()].map((k) => MODELS[k].name).join(' + ');
  setStatus({
    stage: 'downloading',
    progress: Math.min(1, loaded / total),
    backend: device?.backend,
    message: `Loading ${names}`,
    loadedBytes: loaded,
    totalBytes: total,
  });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

interface SamLike {
  get_image_embeddings(inputs: { pixel_values: Tensor }): Promise<Record<string, Tensor>>;
  (inputs: Record<string, Tensor>): Promise<{ iou_scores: Tensor; pred_masks: Tensor; object_score_logits?: Tensor }>;
  dispose(): Promise<unknown>;
}
type Callable = ((...args: never[]) => Promise<unknown>) & { dispose?: () => Promise<unknown> };
type ProcessorFn = (image: RawImage) => Promise<{ pixel_values: Tensor; original_sizes?: unknown; reshaped_input_sizes?: unknown }>;
type TokenizerFn = (texts: string[], opts: { padding: boolean; truncation: boolean }) => Record<string, Tensor>;

interface Loaded {
  backend: Backend;
  edgetam?: { model: SamLike; processor: ProcessorFn };
  segformer?: { model: Callable; processor: ProcessorFn };
  clipseg?: { model: Callable; processor: ProcessorFn; tokenizer: TokenizerFn };
}
const loaded: Partial<Record<ModelKey, Loaded>> = {};
const loading = new Map<ModelKey, Promise<Loaded>>();

function friendlyError(err: unknown): { message: string; code?: 'network' | 'memory' | 'unsupported' } {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch|network|Failed to load|404|ERR_|Could not locate file/i.test(msg)) {
    return { message: 'Could not download the model — check the internet connection (models are only downloaded once).', code: 'network' };
  }
  if (/memory|allocation|RangeError|OrtRun|out of/i.test(msg)) {
    return { message: 'Not enough memory on this device to run the model. Close other tabs and try again.', code: 'memory' };
  }
  if (/WebAssembly|wasm|not supported/i.test(msg)) {
    return { message: 'This browser cannot run the on-device models (WebAssembly is unavailable).', code: 'unsupported' };
  }
  return { message: msg };
}

async function loadOn(key: ModelKey, backend: Backend, f16: boolean): Promise<Loaded> {
  const info = MODELS[key];
  const dtype = dtypeFor(key, backend, f16);
  const opts = {
    device: backend,
    dtype,
    progress_callback: (p: ProgressInfo) => reportDownload(key, p),
  } as const;
  const procOpts = { progress_callback: opts.progress_callback };
  if (key === 'edgetam') {
    const [model, processor] = await Promise.all([EdgeTamModel.from_pretrained(info.id, opts), AutoProcessor.from_pretrained(info.id, procOpts)]);
    return { backend, edgetam: { model: model as unknown as SamLike, processor: processor as unknown as ProcessorFn } };
  }
  if (key === 'segformer') {
    const [model, processor] = await Promise.all([
      SegformerForSemanticSegmentation.from_pretrained(info.id, opts),
      AutoImageProcessor.from_pretrained(info.id, procOpts),
    ]);
    return { backend, segformer: { model: model as unknown as Callable, processor: processor as unknown as ProcessorFn } };
  }
  const [model, processor, tokenizer] = await Promise.all([
    CLIPSegForImageSegmentation.from_pretrained(info.id, opts),
    AutoImageProcessor.from_pretrained(info.id, procOpts),
    AutoTokenizer.from_pretrained(info.id, procOpts),
  ]);
  return {
    backend,
    clipseg: { model: model as unknown as Callable, processor: processor as unknown as ProcessorFn, tokenizer: tokenizer as unknown as TokenizerFn },
  };
}

/** Loads a model (once), on WebGPU when available, falling back to WASM. */
function ensureModel(key: ModelKey): Promise<Loaded> {
  const have = loaded[key];
  if (have) return Promise.resolve(have);
  const inflight = loading.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const dev = device ?? (device = await detectDevice('auto'));
    expected.set(key, modelBytes(key, dev.backend, dev.f16));
    reportDownload(null);
    try {
      let result: Loaded;
      try {
        result = await loadOn(key, dev.backend, dev.f16);
      } catch (err) {
        if (dev.backend !== 'webgpu') throw err;
        // WebGPU can fail on unsupported ops or drivers: retry on WASM.
        console.warn(`[vision] ${MODELS[key].name} failed on WebGPU, using WASM`, err);
        expected.set(key, modelBytes(key, 'wasm', false));
        result = await loadOn(key, 'wasm', false);
      }
      loaded[key] = result;
      return result;
    } finally {
      expected.delete(key);
      for (const f of [...fileProgress.keys()]) if (f.startsWith(`${key}/`)) fileProgress.delete(f);
      loading.delete(key);
    }
  })();
  loading.set(key, p);
  return p;
}

/** Runs `fn` with the model; if it fails on WebGPU, reloads the model on WASM and retries once. */
async function withModel<T>(key: ModelKey, fn: (m: Loaded) => Promise<T>): Promise<T> {
  const m = await ensureModel(key);
  try {
    return await fn(m);
  } catch (err) {
    if (m.backend !== 'webgpu') throw err;
    console.warn(`[vision] ${MODELS[key].name} inference failed on WebGPU, retrying on WASM`, err);
    delete loaded[key];
    if (key === 'edgetam') embeddings.clear();
    expected.set(key, modelBytes(key, 'wasm', false));
    try {
      const wasm = await loadOn(key, 'wasm', false);
      loaded[key] = wasm;
      return await fn(wasm);
    } finally {
      expected.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-photo caches (small LRUs)
// ---------------------------------------------------------------------------

class Lru<V> {
  private map = new Map<string, V>();
  constructor(
    private limit: number,
    private onEvict?: (v: V) => void,
  ) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    const prev = this.map.get(k);
    if (prev !== undefined && prev !== v) this.onEvict?.(prev);
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.limit) {
      const [oldK, oldV] = this.map.entries().next().value as [string, V];
      this.map.delete(oldK);
      this.onEvict?.(oldV);
    }
  }
  delete(k: string): void {
    const v = this.map.get(k);
    if (v !== undefined) this.onEvict?.(v);
    this.map.delete(k);
  }
  clear(): void {
    for (const v of this.map.values()) this.onEvict?.(v);
    this.map.clear();
  }
}

const disposeTensors = (rec: Record<string, Tensor>) => {
  for (const t of Object.values(rec)) (t as Tensor & { dispose?: () => void }).dispose?.();
};

const images = new Lru<RawImage>(3);
const embeddings = new Lru<Record<string, Tensor>>(2, disposeTensors);
const classMaps = new Lru<ClassMap>(6);
const clipMaps = new Lru<ClipMaps>(3);

class NoImageError extends Error {
  constructor() {
    super('The photo is not loaded in the vision worker');
  }
}

function imageOf(photoId: string): RawImage {
  const img = images.get(photoId);
  if (!img) throw new NoImageError();
  return img;
}

// ---------------------------------------------------------------------------
// EdgeTAM
// ---------------------------------------------------------------------------

const SAM_SIZE = 1024;

async function ensureEmbeddings(photoId: string): Promise<Record<string, Tensor>> {
  const have = embeddings.get(photoId);
  if (have) return have;
  const img = imageOf(photoId);
  return withModel('edgetam', async (m) => {
    setStatus({ stage: 'encoding', backend: m.backend, message: 'Reading the photo…' });
    const { model, processor } = m.edgetam!;
    const inputs = await processor(img);
    const emb = await model.get_image_embeddings({ pixel_values: inputs.pixel_values });
    embeddings.set(photoId, emb);
    return emb;
  });
}

interface Decoded {
  /** Predicted IoU per candidate. */
  scores: Float32Array;
  /** Candidates' low-res logits, concatenated. */
  logits: Float32Array;
  lw: number;
  lh: number;
  count: number;
}

function toFloat32(t: Tensor): Float32Array {
  const f = t.type === 'float32' ? t : t.to('float32');
  return f.data as Float32Array;
}

async function decode(photoId: string, prompt: PromptInput, width: number, height: number): Promise<Decoded> {
  return withModel('edgetam', async (m) => {
    // After a WebGPU → WASM retry the cached embedding is gone and is recomputed here.
    const e = await ensureEmbeddings(photoId);
    const sx = SAM_SIZE / width;
    const sy = SAM_SIZE / height;
    const pts = [...prompt.positive.map((p) => ({ p, l: 1 })), ...(prompt.negative ?? []).map((p) => ({ p, l: 0 }))];
    const feeds: Record<string, Tensor> = { ...e };
    if (pts.length > 0) {
      feeds.input_points = new Tensor('float32', Float32Array.from(pts.flatMap(({ p }) => [p.x * sx, p.y * sy])), [1, 1, pts.length, 2]);
      feeds.input_labels = new Tensor('int64', BigInt64Array.from(pts.map(({ l }) => BigInt(l))), [1, 1, pts.length]);
    }
    if (prompt.box) {
      const b = prompt.box;
      feeds.input_boxes = new Tensor('float32', Float32Array.from([b.x * sx, b.y * sy, (b.x + b.w) * sx, (b.y + b.h) * sy]), [1, 1, 4]);
    }
    const out = await m.edgetam!.model(feeds);
    const dims = out.pred_masks.dims; // [1, 1, k, lh, lw]
    const lh = dims[dims.length - 2];
    const lw = dims[dims.length - 1];
    const count = dims[dims.length - 3] ?? 1;
    return { scores: toFloat32(out.iou_scores), logits: toFloat32(out.pred_masks), lw, lh, count };
  });
}

async function segment(photoId: string, prompt: PromptInput, maxSize?: number): Promise<SegmentResult> {
  const img = imageOf(photoId);
  const t0 = performance.now();
  const d = await decode(photoId, prompt, img.width, img.height);
  let best = 0;
  for (let k = 1; k < d.count; k++) if (d.scores[k] > d.scores[best]) best = k;
  const size = maxSize ? analysisSize(img.width, img.height, maxSize) : { width: img.width, height: img.height };
  const mask = logitsToCoverage(d.logits, d.lw, d.lh, size.width, size.height, best * d.lw * d.lh);
  return { width: size.width, height: size.height, mask, score: d.scores[best], ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------------------
// SegFormer + CLIPSeg
// ---------------------------------------------------------------------------

async function ensureClassMap(photoId: string): Promise<ClassMap> {
  const have = classMaps.get(photoId);
  if (have) return have;
  const img = imageOf(photoId);
  return withModel('segformer', async (m) => {
    setStatus({ stage: 'encoding', backend: m.backend, message: 'Recognizing lawn, walls, sky…' });
    const { model, processor } = m.segformer!;
    const inputs = await processor(img);
    const { logits } = (await model(inputs as never)) as { logits: Tensor };
    const [, classes, lh, lw] = logits.dims;
    const size = analysisSize(img.width, img.height);
    const labels = logitsToLabels(toFloat32(logits), classes, lw, lh, size.width, size.height);
    const map: ClassMap = { width: size.width, height: size.height, labels };
    classMaps.set(photoId, map);
    return map;
  });
}

async function ensureClipMaps(photoId: string): Promise<ClipMaps> {
  const have = clipMaps.get(photoId);
  if (have) return have;
  const img = imageOf(photoId);
  return withModel('clipseg', async (m) => {
    setStatus({ stage: 'encoding', backend: m.backend, message: 'Looking for roofs, drives and beds…' });
    const { model, processor, tokenizer } = m.clipseg!;
    const keys = Object.keys(CLIP_PROMPTS) as ClipKey[];
    const text = tokenizer(
      keys.map((k) => CLIP_PROMPTS[k]),
      { padding: true, truncation: true },
    );
    const pixels = await processor(img);
    const { logits } = (await model({ ...text, pixel_values: pixels.pixel_values } as never)) as { logits: Tensor };
    const dims = logits.dims;
    const lh = dims[dims.length - 2];
    const lw = dims[dims.length - 1];
    const data = toFloat32(logits);
    const size = analysisSize(img.width, img.height);
    const probs: ClipMaps['probs'] = {};
    keys.forEach((k, i) => {
      probs[k] = logitsToProbs(data, lw, lh, size.width, size.height, i * lw * lh);
    });
    const maps: ClipMaps = { width: size.width, height: size.height, probs };
    clipMaps.set(photoId, maps);
    return maps;
  });
}

// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

/** Nearest-neighbour lookup of a low-res limit mask: full = min(full, limit). */
function clipToLowRes(full: Mask, limit: Mask): void {
  const xs = new Int32Array(full.width);
  for (let x = 0; x < full.width; x++) xs[x] = Math.min(limit.width - 1, Math.floor(((x + 0.5) * limit.width) / full.width));
  for (let y = 0; y < full.height; y++) {
    const ly = Math.min(limit.height - 1, Math.floor(((y + 0.5) * limit.height) / full.height));
    const lrow = ly * limit.width;
    const row = y * full.width;
    for (let x = 0; x < full.width; x++) {
      const l = limit.data[lrow + xs[x]];
      if (l < full.data[row + x]) full.data[row + x] = l;
    }
  }
}

function scalePolygon(poly: { x: number; y: number }[], sx: number, sy: number) {
  return poly.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

async function refineOne(photoId: string, zone: RefineZoneInput, context: RefineZoneInput[], classMap: ClassMap | null): Promise<RefineZoneResult> {
  const img = imageOf(photoId);
  const W = img.width;
  const H = img.height;
  const prompt = zonePrompt(zone, context, W, H);
  const fail = (iou = 0, classShare: number | null = null): RefineZoneResult => ({ zoneId: zone.id, refined: false, agreement: zoneAgreement(iou, classShare), iou, classShare });
  if (prompt.positive.length === 0) return fail();
  const d = await decode(photoId, { positive: prompt.positive, negative: prompt.negative, box: prompt.box }, W, H);

  // Score the candidates on the analysis grid (cheap), then render the winner at full size.
  const a = classMap ?? { width: analysisSize(W, H).width, height: analysisSize(W, H).height, labels: new Uint8Array(0) };
  const sx = a.width / W;
  const sy = a.height / H;
  const polyA = rasterizePolygon(a.width, a.height, scalePolygon(zone.polygon, sx, sy));
  const allowed = classesForZone(zone.kind);
  let best = -1;
  let bestScore = -Infinity;
  let bestIou = 0;
  let bestShare: number | null = null;
  for (let k = 0; k < d.count; k++) {
    const cand: Mask = { width: a.width, height: a.height, data: logitsToCoverage(d.logits, d.lw, d.lh, a.width, a.height, k * d.lw * d.lh) };
    const iou = maskIoU(cand, polyA);
    const classShare = classMap ? classAgreement(cand, classMap, allowed) : null;
    const score = candidateScore({ iou, classShare, modelScore: d.scores[k] });
    if (score > bestScore) {
      bestScore = score;
      best = k;
      bestIou = iou;
      bestShare = classShare;
    }
  }
  if (best < 0 || bestIou < MIN_REFINE_IOU) return fail(bestIou, bestShare);

  const full: Mask = { width: W, height: H, data: logitsToCoverage(d.logits, d.lw, d.lh, W, H, best * d.lw * d.lh) };
  // Keep a leaking mask near the AI outline (limit computed on the analysis grid).
  const limit = rasterizePolygon(a.width, a.height, scalePolygon(zone.polygon, sx, sy));
  growMask(limit, clipMarginFor(zone.polygon) * sx);
  clipToLowRes(full, limit);
  cleanMask(full);
  const polygon = largestContour(full, { tolerancePx: Math.max(1.5, Math.max(W, H) * 0.0015) });
  if (polygon.length < 3) return fail(bestIou, bestShare);
  return {
    zoneId: zone.id,
    refined: true,
    mask: full.data,
    polygon: polygon.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
    agreement: zoneAgreement(bestIou, bestShare),
    iou: Math.round(bestIou * 1000) / 1000,
    classShare: bestShare === null ? null : Math.round(bestShare * 1000) / 1000,
  };
}

async function refine(id: number, photoId: string, zones: RefineZoneInput[], context: RefineZoneInput[]): Promise<RefineZoneResult[]> {
  imageOf(photoId);
  let classMap: ClassMap | null = null;
  try {
    classMap = await ensureClassMap(photoId);
  } catch (err) {
    // The semantic check is a bonus: sharpen without it.
    console.warn('[vision] semantic check unavailable', err);
  }
  await ensureEmbeddings(photoId);
  const results: RefineZoneResult[] = [];
  const ctx = context.length ? context : zones;
  for (let i = 0; i < zones.length; i++) {
    setStatus({ stage: 'encoding', backend: device?.backend, message: `Sharpening ${i + 1} of ${zones.length} areas…` });
    post({ type: 'progress', id, done: i, total: zones.length });
    results.push(await refineOne(photoId, zones[i], ctx, classMap));
  }
  post({ type: 'progress', id, done: zones.length, total: zones.length });
  return results;
}

// ---------------------------------------------------------------------------
// Offline map / kind guess
// ---------------------------------------------------------------------------

async function offlineMap(photoId: string, interior: boolean): Promise<OfflineMapResult> {
  const img = imageOf(photoId);
  const classes = await ensureClassMap(photoId);
  let clip: ClipMaps | undefined;
  if (!interior) {
    try {
      clip = await ensureClipMaps(photoId);
    } catch (err) {
      console.warn('[vision] CLIPSeg unavailable, mapping without roofs/drives', err);
    }
  }
  const zones = zonesFromClasses(classes, { width: img.width, height: img.height }, interior, clip);
  return { zones, category: offlineCategory(classes, interior), usedClip: !!clip };
}

/** Zone kind of the dominant mapped class under a mask, from the cached class map (no model run). */
function kindOf(photoId: string, mask: Mask, interior: boolean): string | null {
  const classes = classMaps.get(photoId);
  if (!classes) return null;
  const counts = new Map<string, number>();
  let total = 0;
  const sx = mask.width / classes.width;
  const sy = mask.height / classes.height;
  for (let cy = 0; cy < classes.height; cy++) {
    const my = Math.min(mask.height - 1, Math.floor((cy + 0.5) * sy));
    for (let cx = 0; cx < classes.width; cx++) {
      const mx = Math.min(mask.width - 1, Math.floor((cx + 0.5) * sx));
      if (mask.data[my * mask.width + mx] < 128) continue;
      total++;
      const kind = zoneKindForClass(classes.labels[cy * classes.width + cx], interior);
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  if (total === 0) return null;
  const [kind, n] = [...counts.entries()].sort((p, q) => q[1] - p[1])[0] ?? [null, 0];
  return kind && n / total >= 0.5 ? kind : null;
}

// ---------------------------------------------------------------------------
// Dispatch (one request at a time — ONNX Runtime web sessions don't run concurrently anyway)
// ---------------------------------------------------------------------------

async function handle(req: WorkerRequest): Promise<{ data: unknown; transfer?: Transferable[] }> {
  switch (req.op) {
    case 'init': {
      device = await detectDevice(req.prefer);
      const result: InitResult = { backend: device.backend, f16: device.f16, threads: onnxWasm?.numThreads ?? 1 };
      if (status.stage === 'idle') setStatus({ stage: 'idle', backend: device.backend });
      return { data: result };
    }
    case 'cached': {
      const dev = device ?? (device = await detectDevice('auto'));
      const out: Partial<Record<ModelKey, boolean>> = {};
      for (const key of req.models) {
        if (loaded[key]) {
          out[key] = true;
          continue;
        }
        try {
          out[key] = await ModelRegistry.is_cached(MODELS[key].id, { dtype: dtypeFor(key, dev.backend, dev.f16), device: dev.backend });
        } catch {
          out[key] = false;
        }
      }
      return { data: out };
    }
    case 'setImage': {
      const rgba = new RawImage(req.data, req.width, req.height, 4);
      images.set(req.photoId, rgba.rgb());
      embeddings.delete(req.photoId);
      classMaps.delete(req.photoId);
      clipMaps.delete(req.photoId);
      return { data: true };
    }
    case 'encode':
      await ensureEmbeddings(req.photoId);
      return { data: true };
    case 'segment': {
      const r = await segment(req.photoId, req.prompt, req.maxSize);
      return { data: r, transfer: [r.mask.buffer] };
    }
    case 'refine': {
      const results = await refine(req.id, req.photoId, req.zones, req.context);
      return { data: results, transfer: results.flatMap((r) => (r.mask ? [r.mask.buffer] : [])) };
    }
    case 'offlineMap':
      return { data: await offlineMap(req.photoId, req.interior) };
    case 'kindOf':
      return { data: kindOf(req.photoId, { width: req.width, height: req.height, data: req.mask }, req.interior) };
    case 'forget':
      images.delete(req.photoId);
      embeddings.delete(req.photoId);
      classMaps.delete(req.photoId);
      clipMaps.delete(req.photoId);
      return { data: true };
  }
}

let queue: Promise<void> = Promise.resolve();

/** Requests that run models (and so move the status through downloading / encoding). */
const MODEL_OPS = new Set<WorkerRequest['op']>(['encode', 'segment', 'refine', 'offlineMap']);

/** Back to 'ready' (or 'idle' before any model loaded) after a model request succeeded. */
function settle(): void {
  const stage = Object.keys(loaded).length ? 'ready' : 'idle';
  if (status.stage !== stage || status.message || status.backend !== device?.backend) setStatus({ stage, backend: device?.backend });
}

scope.addEventListener('message', (e) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      const { data, transfer } = await handle(req);
      if (MODEL_OPS.has(req.op)) settle();
      post({ type: 'result', id: req.id, ok: true, data }, transfer);
    } catch (err) {
      if (err instanceof NoImageError) {
        post({ type: 'result', id: req.id, ok: false, error: err.message, code: 'no-image' });
        return;
      }
      const f = friendlyError(err);
      console.error('[vision]', err);
      setStatus({ stage: 'error', backend: device?.backend, message: f.message });
      post({ type: 'result', id: req.id, ok: false, error: f.message, code: f.code });
    }
  });
});

