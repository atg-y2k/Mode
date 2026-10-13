/**
 * A narrow, typed facade over the parts of OpenCV.js (@techstark/opencv-js,
 * Apache-2.0) the hand-off alignment uses, plus a lazy loader.
 *
 * The package's default export is the Emscripten module factory's Promise
 * (it resolves once the WASM runtime is ready); older builds export the
 * Module object and signal readiness through `onRuntimeInitialized`. Both
 * are handled. The 13 MB script is only fetched on the first import.
 */

export interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  data64F: Float64Array;
  empty(): boolean;
  delete(): void;
}

export interface CvKeyPoint {
  pt: { x: number; y: number };
}

export interface CvKeyPointVector {
  size(): number;
  get(i: number): CvKeyPoint;
  delete(): void;
}

export interface CvDMatch {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

export interface CvDMatchVector {
  size(): number;
  get(i: number): CvDMatch;
  delete(): void;
}

export interface CvDMatchVectorVector {
  size(): number;
  get(i: number): CvDMatchVector;
  delete(): void;
}

export interface CvORB {
  detectAndCompute(image: CvMat, mask: CvMat, keypoints: CvKeyPointVector, descriptors: CvMat): void;
  delete(): void;
}

export interface CvBFMatcher {
  knnMatch(query: CvMat, train: CvMat, matches: CvDMatchVectorVector, k: number): void;
  delete(): void;
}

/** The subset of the OpenCV.js module the alignment needs. */
export interface CvLike {
  Mat: new (...args: number[]) => CvMat;
  KeyPointVector: new () => CvKeyPointVector;
  DMatchVectorVector: new () => CvDMatchVectorVector;
  ORB: new (nfeatures?: number) => CvORB;
  BFMatcher: new (normType: number, crossCheck: boolean) => CvBFMatcher;
  estimateAffine2D(
    from: CvMat,
    to: CvMat,
    inliers: CvMat,
    method: number,
    ransacReprojThreshold: number,
    maxIters: number,
    confidence: number,
    refineIters: number,
  ): CvMat;
  CV_8UC1: number;
  CV_32FC2: number;
  NORM_HAMMING: number;
  RANSAC: number;
}

function isCv(value: unknown): value is CvLike {
  return !!value && typeof (value as { Mat?: unknown }).Mat === 'function' && typeof (value as { ORB?: unknown }).ORB === 'function';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Resolves an imported @techstark/opencv-js namespace to the ready module
 * (Promise export, ready Module, or Module awaiting onRuntimeInitialized).
 */
export async function resolveOpenCv(imported: unknown): Promise<CvLike> {
  let mod: unknown = (imported as { default?: unknown })?.default ?? imported;
  if (isThenable(mod)) mod = await mod;
  if (isCv(mod)) return mod;
  if (mod && typeof mod === 'object') {
    const pending = mod as { onRuntimeInitialized?: () => void };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenCV.js did not initialize.')), 60_000);
      pending.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    if (isCv(mod)) return mod;
  }
  throw new Error('OpenCV.js loaded but is missing the functions alignment needs.');
}

let loading: Promise<CvLike> | null = null;

/** Lazily imports and initializes OpenCV.js (once per realm: page or worker). */
export function loadOpenCv(): Promise<CvLike> {
  if (!loading) {
    loading = import('@techstark/opencv-js').then(resolveOpenCv);
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
