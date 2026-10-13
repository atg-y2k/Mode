/**
 * Manual hand-off engine (browser): prepare what the user pastes into the
 * ChatGPT / Gemini app, and turn what comes back into an aligned, protected
 * composite. Techniques borrowed from comfyui_qwen_edit_pixel_perfect (marked
 * region + fixed hint + feature alignment + restore outside), A1111 / ComfyUI
 * crop-and-stitch ("only masked" inpainting), OpenAI's and Google's editing
 * guides, and Freepik's per-channel color correction. See SPEC.md §5.
 */
import type { DesignBrief, HandoffApp, HandoffPack, Photo, SceneMap } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export interface PrepareOptions {
  app: HandoffApp;
  /** Long edge of the exported image (default 2048 for full frame, 1536 for crops). */
  maxEdge?: number;
  /** Force full frame even for small targets. */
  fullFrame?: boolean;
}

export interface PreparedHandoff {
  /** Clean export (EXIF-free JPEG, q≈0.92) and the same with the selection marker drawn on it (PNG). */
  clean: Blob;
  marked: Blob;
  crop: HandoffPack['crop'];
  outW: number;
  outH: number;
  markerColor: string;
  /** Ratio label the export was snapped to, e.g. "4:3". */
  ratio: string;
}

/**
 * Builds the export for one variation:
 * - crop vs full frame: crop when the target covers < ~35–40% of the photo
 *   (bounding box + 30–50% context, ≥ 1/3 of the frame), else full frame;
 * - snap to an aspect ratio the app produces (ChatGPT 1:1 · 3:2 · 2:3; Gemini
 *   1:1 · 3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · 4:5 · 5:4) by growing the crop
 *   (never squashing) and clamping to the photo;
 * - resize to `maxEdge`; re-encode (drops EXIF/GPS);
 * - marker: outline only (no fill), color = the hue least present in the crop
 *   among magenta / cyan / lime, 1 px dark halo, drawn 2–4 px OUTSIDE the
 *   composite feather band so leftover ink is discarded by the composite.
 */
export declare function prepareHandoff(
  image: ImageDataLike,
  target: Mask,
  opts: PrepareOptions,
): Promise<PreparedHandoff>;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface PromptContext {
  app: HandoffApp;
  /** The plan's model-neutral instruction for this variation. */
  instruction: string;
  /** Plain-language description of where the change goes ("the walkway in the lower centre, from the driveway at left to the front door"). */
  areaText: string;
  /** Named things to keep (from scene zones outside the target + architecture keep-list). */
  keep: string[];
  /** Light description ("soft morning light from the left; shadows fall to the right"). */
  light: string;
  /** Short style label ("1950s ranch", "Craftsman bungalow"). */
  style: string;
  ratio: string;
  markerColorName: string;
  strictness: NonNullable<DesignBrief['strictness']>;
  plantMaturity: DesignBrief['plantMaturity'];
  /** Roles of attached inspiration images, in order (Image 2, 3, …). */
  references: { role: string }[];
  interior: boolean;
}

/**
 * App-specific prompt (ChatGPT: OpenAI's editing phrasing — "replace ONLY…",
 * KEEP list, "Preserve camera angle…", "Do not change anything else";
 * Gemini: Google's semantic-masking opening sentence and a narrative
 * paragraph with positively phrased exclusions). Always: one change, area in
 * words AND marker, keep list, same framing/ratio, match light & white
 * balance, "the {color} outline is only a selection marker — remove it and do
 * not add any border, edging or line along it". Strictness adjusts the
 * creative latitude sentence. ≤ ~1,800 characters (URL-safe for ChatGPT).
 */
export declare function buildHandoffPrompt(ctx: PromptContext): string;

/** Builds the PromptContext pieces from the scene map + brief for a target (pure). */
export declare function promptContextFromScene(
  scene: SceneMap | undefined,
  brief: DesignBrief,
  targetZoneIds: string[],
  extras: Pick<PromptContext, 'app' | 'instruction' | 'ratio' | 'markerColorName' | 'references'>,
): PromptContext;

/** One-line fixes the user can paste into the same chat ("Put back the window I had on the left…"). */
export declare const FIX_PROMPTS: { id: string; label: string; text: string; app?: HandoffApp }[];

/** https://chatgpt.com/?prompt=… (prefills without sending when opened from another site); null when the prompt is too long for a URL. */
export declare function chatgptDeepLink(prompt: string, opts?: { temporary?: boolean }): string | null;

/** https://gemini.google.com/app (Gemini has no prompt prefill link). */
export declare const GEMINI_APP_URL: string;

// ---------------------------------------------------------------------------
// Import (runs alignment in a Web Worker with OpenCV.js)
// ---------------------------------------------------------------------------

export interface ImportResult {
  /** Final image at photo size: original outside the target, the returned edit inside (aligned, color-corrected, feathered). */
  composite: ImageDataLike;
  report: import('../../shared/types').AlignmentReport;
  /** 0..255 per pixel at photo size (or downscaled): where the model changed things OUTSIDE the target (for a toggleable heatmap). */
  outsideChangeMap: { width: number; height: number; data: Uint8Array };
  /** Bounding boxes (photo px) of notable outside changes, largest first. */
  outsideBlobs: { x: number; y: number; w: number; h: number; area: number }[];
}

/**
 * Maps a returned image back onto the photo:
 * 1. undo the export crop/scale guess, then refine with ORB features (target
 *    + margin masked out on the original side), ratio test 0.75, robust
 *    similarity/affine fit (RANSAC 3 px); accept with ≥ 40 inliers and a good
 *    inlier ratio, else fall back to the plain crop/scale mapping (aligned: false);
 * 2. fit per-channel gain/offset on pixels OUTSIDE the target (robust least
 *    squares) and apply it to the returned image to remove color/white-balance drift;
 * 3. feathered composite inside the target (target mask grown a little);
 * 4. change map outside the target (blurred Lab ΔE at ~512 px).
 */
export declare function importHandoffResult(
  photo: Pick<Photo, 'width' | 'height'>,
  original: ImageDataLike,
  target: Mask,
  pack: Pick<HandoffPack, 'crop' | 'outW' | 'outH'>,
  returned: Blob,
  signal?: AbortSignal,
): Promise<ImportResult>;
