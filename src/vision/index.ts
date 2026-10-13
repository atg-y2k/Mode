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
 */
import type { Pt, SceneMap, SceneZone } from '../../shared/types';
import type { ImageDataLike, Mask } from '../engine/types';

export type VisionStage = 'idle' | 'downloading' | 'encoding' | 'ready' | 'error';

export interface VisionStatus {
  stage: VisionStage;
  /** 0..1 while downloading. */
  progress?: number;
  backend?: 'webgpu' | 'wasm';
  message?: string;
}

export declare function getVisionStatus(): VisionStatus;
export declare function onVisionStatus(listener: (s: VisionStatus) => void): () => void;

/** Encodes the photo once (EdgeTAM image embedding); later prompts take ~0.1 s. */
export declare function prepareVision(photoId: string, image: ImageDataLike): Promise<void>;

/** Mask for a click (positive points) plus optional negative points and a box, at photo size. */
export declare function segmentAt(
  photoId: string,
  prompt: { positive: Pt[]; negative?: Pt[]; box?: { x: number; y: number; w: number; h: number } },
): Promise<Mask>;

/**
 * Refines AI zone polygons into exact masks: per zone a box + 2–5 positive
 * points inside the shrunk polygon + negatives in neighbouring zones; of the
 * candidate masks keep the one that best overlaps the polygon (IoU) and agrees
 * with ADE20K classes. Returns masks keyed by zone id plus simplified polygons.
 */
export declare function refineZones(
  photoId: string,
  image: ImageDataLike,
  zones: SceneZone[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, { mask: Mask; polygon: Pt[]; agreement: number }>>;

/**
 * Offline scene map from semantic segmentation (no Claude): zones for lawn,
 * planting beds/plants, trees, paths/sidewalk, driveway/road, house/building,
 * roof (CLIPSeg), door, windows, fence, sky; interiors: wall, floor, ceiling,
 * cabinets, countertop, windows. Category guessed from the class mix.
 */
export declare function offlineSceneMap(photoId: string, image: ImageDataLike, interior: boolean): Promise<SceneMap>;

/** Mask → simplified clockwise polygon (largest component), in photo px. */
export declare function maskToPolygon(mask: Mask, tolerancePx?: number): Pt[];
