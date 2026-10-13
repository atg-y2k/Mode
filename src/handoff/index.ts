/**
 * Manual hand-off engine (browser): prepare what the user pastes into the
 * ChatGPT / Gemini app, and turn what comes back into an aligned, protected
 * composite. Techniques borrowed from comfyui_qwen_edit_pixel_perfect (marked
 * region + fixed hint + feature alignment + restore outside), A1111 / ComfyUI
 * crop-and-stitch ("only masked" inpainting), OpenAI's and Google's editing
 * guides, and Freepik's per-channel color correction. See SPEC.md §5.
 *
 * Mode never automates chatgpt.com or gemini.google.com: it only prepares
 * files and text, and receives what the user brings back.
 *
 * The TARGET mask passed to prepareHandoff and importHandoffResult must be
 * the same (photo size; soft edges fine — e.g. buildTargetMask's output):
 * both derive the composite band and the marker position from it. An empty
 * mask, or one covering ≥ 90 % of the photo, means "the whole image may
 * change" (full frame, no marker, nothing protected).
 *
 * Module map: prepare.ts (crop / ratio / marker), prompts.ts (templates,
 * scene → context, fix prompts), deeplinks.ts, filenames.ts (Mode's own
 * download names, shared with the server), watermark.ts (Gemini's corner
 * sparkle), pipeline.ts (import, incl. the wrong-image check), with
 * alignCore.ts (OpenCV ORB + RANSAC), colorMatch.ts, changeMap.ts, bands.ts,
 * resample.ts; prepare.worker.ts (export) and align.worker.ts (import, with
 * OpenCV.js loaded lazily) run the pixel work off the main thread via
 * client.ts, which falls back to the main thread without Workers.
 * Tip: call warmUpAlignment() when a hand-off opens (prepareHandoff does it
 * too) so OpenCV is ready by the time the user brings the image back.
 */
import type { HandoffPack, Photo } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';
import { blobToImageData, imageDataToBlob } from '../lib/imageImport';
import { runImportJob, runPrepareJob, warmUpAlignment, type ImportProgress } from './client';
import type { ImportResult } from './pipeline';
import { resampleRGBA } from './resample';

export type { PromptContext, SceneContextOptions } from './prompts';
export type { ImportResult, InsideCheck } from './pipeline';
export type { ImportProgress } from './client';
export type { RatioSpec } from './prepare';
export {
  buildHandoffPrompt,
  promptContextFromScene,
  FIX_PROMPTS,
  fixPromptsFor,
  changeFromInstruction,
  referenceSentences,
  MAX_PROMPT_CHARS,
  MAX_REFERENCES,
} from './prompts';
export { chatgptDeepLink, GEMINI_APP_URL, CHATGPT_URL } from './deeplinks';
export { HANDOFF_RATIOS, MARKER_COLORS, markerColorName, parseRatioList, ratioLabel, ratiosFor } from './prepare';
export { UNCHANGED_DELTA_E, UNCHANGED_RATIO, looksUnchanged } from './pipeline';
export { HANDOFF_DOWNLOAD_PREFIX, handoffDownloadName, isOwnHandoffDownload } from './filenames';
export { WATERMARK_CORNER_SHARE, targetTouchesWatermark, watermarkCorner } from './watermark';
export { warmUpAlignment } from './client';

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export interface PrepareOptions {
  app: import('../../shared/types').HandoffApp;
  /** Long edge of the exported image (default 2048 for full frame, 1536 for crops). */
  maxEdge?: number;
  /** Force full frame even for small targets. */
  fullFrame?: boolean;
  /** Aspect ratios to snap to instead of the app's defaults (HANDOFF_RATIOS; a user override). */
  ratios?: readonly import('./prepare').RatioSpec[];
  /** Start loading the alignment engine in the background (default true). */
  warmUp?: boolean;
}

export interface PreparedHandoff {
  /** Clean export (EXIF-free JPEG, q≈0.92) and the same with the selection marker drawn on it (PNG). */
  clean: Blob;
  marked: Blob;
  crop: HandoffPack['crop'];
  outW: number;
  outH: number;
  /** Marker hex; '' when no marker was drawn (whole-image target). */
  markerColor: string;
  /** Ratio label the export was snapped to, e.g. "4:3". */
  ratio: string;
  /** Prompt name of the marker colour ("magenta"); '' without a marker. */
  markerColorName: string;
  /** 'crop' = a region around the target was exported; 'full' = the whole frame (maybe trimmed to a ratio). */
  mode: 'crop' | 'full';
  /** Share of the photo the target covers (0..1). */
  coverage: number;
}

/** JPEG quality of the clean export. */
const CLEAN_QUALITY = 0.92;

/**
 * Builds the export for one variation:
 * - crop vs full frame: crop when the target covers < ~37.5 % of the photo
 *   (bounding box + 40 % context per side, ≥ 1/3 of the frame per side),
 *   else full frame;
 * - snap to an aspect ratio the app produces (ChatGPT 1:1 · 3:2 · 2:3 · 4:3 ·
 *   3:4 · 16:9 · 9:16; Gemini the same + 4:5 · 5:4; or `opts.ratios`) by
 *   growing the crop (never squashing) and clamping to the photo;
 * - resize to `maxEdge`; re-encode (drops EXIF/GPS);
 * - marker: outline only (no fill), color = the hue least present in the crop
 *   among magenta / cyan / lime, 1 px dark halo, drawn 2–4 px OUTSIDE the
 *   composite feather band so leftover ink is discarded by the composite.
 */
export async function prepareHandoff(image: ImageDataLike, target: Mask, opts: PrepareOptions): Promise<PreparedHandoff> {
  if (opts.warmUp !== false) scheduleWarmUp();
  const r = await runPrepareJob(image, target, {
    app: opts.app,
    maxEdge: opts.maxEdge,
    fullFrame: opts.fullFrame,
    ...(opts.ratios?.length ? { ratios: opts.ratios.map((x) => ({ label: x.label, w: x.w, h: x.h })) } : {}),
  });
  let clean: Blob;
  let marked: Blob;
  if ('clean' in r) {
    clean = r.clean;
    marked = r.marked;
  } else {
    [clean, marked] = await Promise.all([imageDataToBlob(r.cleanPixels, 'image/jpeg', CLEAN_QUALITY), imageDataToBlob(r.markedPixels, 'image/png')]);
  }
  return {
    clean,
    marked,
    crop: { ...r.crop },
    outW: r.outW,
    outH: r.outH,
    markerColor: r.markerColor,
    ratio: r.ratio,
    markerColorName: r.markerColorName,
    mode: r.mode,
    coverage: r.coverage,
  };
}

function scheduleWarmUp(): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(() => warmUpAlignment(), { timeout: 3000 });
  else setTimeout(() => warmUpAlignment(), 1500);
}

// ---------------------------------------------------------------------------
// Import (runs alignment in a Web Worker with OpenCV.js)
// ---------------------------------------------------------------------------

/** Returned images larger than this (long edge) are shrunk before aligning. */
const MAX_RETURNED_EDGE = 4096;

async function decodeReturned(blob: Blob): Promise<ImageDataLike> {
  const img = await blobToImageData(blob);
  const long = Math.max(img.width, img.height);
  if (long <= MAX_RETURNED_EDGE) return { width: img.width, height: img.height, data: img.data };
  const k = MAX_RETURNED_EDGE / long;
  return resampleRGBA(
    { width: img.width, height: img.height, data: img.data },
    { x: 0, y: 0, w: img.width, h: img.height },
    Math.max(1, Math.round(img.width * k)),
    Math.max(1, Math.round(img.height * k)),
  );
}

/**
 * Maps a returned image back onto the photo:
 * 1. undo the export crop/scale guess, then refine with ORB features (target
 *    + margin masked out on the original side), ratio test 0.75, robust
 *    affine fit (RANSAC 3 px); accept with ≥ 40 inliers and an inlier ratio
 *    ≥ 0.3, else fall back to the plain crop/scale mapping (aligned: false);
 * 2. fit per-channel gain/offset on pixels OUTSIDE the target (robust least
 *    squares) and apply it to the returned image to remove color/white-balance drift;
 * 3. feathered composite inside the target (target mask grown a little);
 * 4. change map outside the target (blurred Lab ΔE at ~512 px).
 * `onProgress` reports 'loading' (decoding / first OpenCV load), 'aligning', 'compositing'.
 * `opts.inside`: the area the wrong-image check compares (default: the
 * target) — the element's own area when the target has room beside it.
 */
export async function importHandoffResult(
  photo: Pick<Photo, 'width' | 'height'>,
  original: ImageDataLike,
  target: Mask,
  pack: Pick<HandoffPack, 'crop' | 'outW' | 'outH'>,
  returned: Blob,
  signal?: AbortSignal,
  onProgress?: (stage: ImportProgress) => void,
  opts: { inside?: Mask | null } = {},
): Promise<ImportResult> {
  if (original.width !== photo.width || original.height !== photo.height) {
    throw new Error(`The starting image is ${original.width}×${original.height} but the photo is ${photo.width}×${photo.height}.`);
  }
  if (target.width !== photo.width || target.height !== photo.height) {
    throw new Error('The target outline does not match the photo size.');
  }
  onProgress?.('loading');
  const decoded = await decodeReturned(returned);
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
  return runImportJob(
    { original, target, crop: pack.crop, outW: pack.outW, outH: pack.outH, returned: decoded, ...(opts.inside ? { inside: opts.inside } : {}) },
    signal,
    onProgress,
  );
}
