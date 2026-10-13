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
 * scene → context, fix prompts), deeplinks.ts, pipeline.ts (import), with
 * alignCore.ts (OpenCV ORB + RANSAC), colorMatch.ts, changeMap.ts, bands.ts,
 * resample.ts; align.worker.ts + client.ts run imports off the main thread.
 */
import type { HandoffPack, Photo } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';
import { blobToImageData, imageDataToBlob } from '../lib/imageImport';
import { runImportJob, warmUpAlignment, type ImportProgress } from './client';
import type { ImportResult } from './pipeline';
import { renderHandoff } from './prepare';
import { resampleRGBA } from './resample';

export type { PromptContext, SceneContextOptions } from './prompts';
export type { ImportResult } from './pipeline';
export type { ImportProgress } from './client';
export { buildHandoffPrompt, promptContextFromScene, FIX_PROMPTS, fixPromptsFor, changeFromInstruction, MAX_PROMPT_CHARS } from './prompts';
export { chatgptDeepLink, GEMINI_APP_URL, CHATGPT_URL } from './deeplinks';
export { HANDOFF_RATIOS, MARKER_COLORS, markerColorName, ratioLabel } from './prepare';
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
 * - snap to an aspect ratio the app produces (ChatGPT 1:1 · 3:2 · 2:3; Gemini
 *   1:1 · 3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · 4:5 · 5:4) by growing the crop
 *   (never squashing) and clamping to the photo;
 * - resize to `maxEdge`; re-encode (drops EXIF/GPS);
 * - marker: outline only (no fill), color = the hue least present in the crop
 *   among magenta / cyan / lime, 1 px dark halo, drawn 2–4 px OUTSIDE the
 *   composite feather band so leftover ink is discarded by the composite.
 */
export async function prepareHandoff(image: ImageDataLike, target: Mask, opts: PrepareOptions): Promise<PreparedHandoff> {
  if (opts.warmUp !== false) scheduleWarmUp();
  const r = renderHandoff(image, target, { app: opts.app, maxEdge: opts.maxEdge, fullFrame: opts.fullFrame });
  const [clean, marked] = await Promise.all([imageDataToBlob(r.clean, 'image/jpeg', CLEAN_QUALITY), imageDataToBlob(r.marked, 'image/png')]);
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
 */
export async function importHandoffResult(
  photo: Pick<Photo, 'width' | 'height'>,
  original: ImageDataLike,
  target: Mask,
  pack: Pick<HandoffPack, 'crop' | 'outW' | 'outH'>,
  returned: Blob,
  signal?: AbortSignal,
  onProgress?: (stage: ImportProgress) => void,
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
  return runImportJob({ original, target, crop: pack.crop, outW: pack.outW, outH: pack.outH, returned: decoded }, signal, onProgress);
}
