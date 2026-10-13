/**
 * Feature alignment of a returned image to the original (pure given an
 * OpenCV module, so node tests run it with the same build as the browser).
 *
 * Recipe (benchmarked in the research notes, ported from the MIT
 * comfyui_qwen_edit_pixel_perfect pattern): ORB (1,500 features) on both
 * grayscale images at ~1024 px, the edited target (+20 px) masked out on the
 * original; brute-force Hamming kNN (k = 2) with Lowe's 0.75 ratio test;
 * estimateAffine2D with RANSAC at 3 px (an affine beats a homography here —
 * the latter over-fits); accept with ≥ 40 inliers and an inlier ratio ≥ 0.3
 * and a transform that stays plausible next to the initial guess, else keep
 * the guess (aligned: false).
 *
 * Coordinates are continuous (pixel centre = index + 0.5); OpenCV's
 * keypoints use pixel centre = index, so +0.5 is added on the way in.
 */
import type { CvDMatchVector, CvKeyPointVector, CvLike, CvMat } from './cv';
import { affineScale, applyAffine, type Affine, type GrayImage } from './resample';

export interface AlignOptions {
  /** ORB feature budget per image (default 1500). */
  features?: number;
  /** Lowe ratio test (default 0.75). */
  ratio?: number;
  /** RANSAC reprojection threshold in working px (default 3). */
  ransacPx?: number;
  minInliers?: number;
  minInlierRatio?: number;
  /** 255 = features allowed on the returned image (optional; e.g. the guessed target masked out). */
  returnedMask?: Uint8Array | null;
  /** Matches whose guessed position is farther than this share of the returned diagonal are dropped before RANSAC (default 0.3). */
  guessTolerance?: number;
}

export interface AlignResult {
  /** original → returned (continuous working coords): the fit when accepted, else the initial guess. */
  matrix: Affine;
  /** The RANSAC fit even when rejected (null when none could be computed). */
  fitted: Affine | null;
  accepted: boolean;
  /** Ratio-test matches. */
  matches: number;
  inliers: number;
  inlierRatio: number;
  /** Mean reprojection error of the inliers, in ORIGINAL working px. */
  residualPx: number;
  /** Why the fit was rejected ('' when accepted). */
  reason: string;
}

const DEFAULTS = { features: 1500, ratio: 0.75, ransacPx: 3, minInliers: 40, minInlierRatio: 0.3, guessTolerance: 0.3 };

function grayToMat(cv: CvLike, img: GrayImage): CvMat {
  const m = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  m.data.set(img.data);
  return m;
}

function maskToMat(cv: CvLike, mask: Uint8Array | null | undefined, width: number, height: number): CvMat {
  if (!mask) return new cv.Mat();
  const m = new cv.Mat(height, width, cv.CV_8UC1);
  m.data.set(mask);
  return m;
}

/** Singular values (σ1 ≥ σ2) and rotation (degrees) of the affine's linear part. */
export function affineShape(m: Affine): { s1: number; s2: number; rotationDeg: number; det: number } {
  const [a, b, , d, e] = m;
  const det = a * e - b * d;
  // σ² are the eigenvalues of LᵀL.
  const p = a * a + d * d;
  const q = a * b + d * e;
  const r = b * b + e * e;
  const tr = p + r;
  const disc = Math.sqrt(Math.max(0, ((p - r) / 2) ** 2 + q * q));
  const s1 = Math.sqrt(Math.max(0, tr / 2 + disc));
  const s2 = Math.sqrt(Math.max(0, tr / 2 - disc));
  const rotationDeg = (Math.atan2(d - b, a + e) * 180) / Math.PI;
  return { s1, s2, rotationDeg, det };
}

/**
 * Why `fit` is implausible next to the `guess` for images of the given
 * sizes ('' when plausible): flipped, scale off by > 1.6×, anisotropic
 * (> 1.3), rotated > 12°, or corners displaced by > 35 % of the diagonal.
 */
export function implausibility(fit: Affine, guess: Affine, original: { width: number; height: number }, returned: { width: number; height: number }): string {
  const shape = affineShape(fit);
  if (!(shape.det > 0)) return 'flipped or degenerate transform';
  const ratio = affineScale(fit) / Math.max(1e-9, affineScale(guess));
  if (ratio < 1 / 1.6 || ratio > 1.6) return `scale differs ${ratio.toFixed(2)}× from the export`;
  if (shape.s1 / Math.max(1e-9, shape.s2) > 1.3) return 'stretched transform';
  if (Math.abs(shape.rotationDeg) > 12) return 'rotated transform';
  const diag = Math.hypot(returned.width, returned.height);
  const corners = [
    [0, 0],
    [original.width, 0],
    [0, original.height],
    [original.width, original.height],
  ];
  for (const [x, y] of corners) {
    const p = applyAffine(fit, x, y);
    const q = applyAffine(guess, x, y);
    if (Math.hypot(p.x - q.x, p.y - q.y) > 0.35 * diag) return 'framing moved too far from the export';
  }
  return '';
}

/**
 * Aligns `returned` to `original` (both grayscale at a similar working
 * scale). `mask` (original-sized, 255 = usable) excludes the edited target
 * on the original; `initial` maps original → returned (continuous coords)
 * and is used to drop wild matches, to sanity-check the fit and as the
 * fallback.
 */
export function alignFeatures(
  cv: CvLike,
  original: GrayImage,
  returned: GrayImage,
  mask: Uint8Array | null,
  initial: Affine,
  opts: AlignOptions = {},
): AlignResult {
  const o = { ...DEFAULTS, ...opts };
  const reject = (reason: string, extra: Partial<AlignResult> = {}): AlignResult => ({
    matrix: initial,
    fitted: null,
    accepted: false,
    matches: 0,
    inliers: 0,
    inlierRatio: 0,
    residualPx: 0,
    reason,
    ...extra,
  });
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  try {
    const imgO = own(grayToMat(cv, original));
    const imgR = own(grayToMat(cv, returned));
    const maskO = own(maskToMat(cv, mask, original.width, original.height));
    const maskR = own(maskToMat(cv, opts.returnedMask, returned.width, returned.height));
    const orb = own(new cv.ORB(o.features));
    const kpO: CvKeyPointVector = own(new cv.KeyPointVector());
    const kpR: CvKeyPointVector = own(new cv.KeyPointVector());
    const descO = own(new cv.Mat());
    const descR = own(new cv.Mat());
    orb.detectAndCompute(imgO, maskO, kpO, descO);
    orb.detectAndCompute(imgR, maskR, kpR, descR);
    if (kpO.size() < 8 || kpR.size() < 8 || descO.rows < 2 || descR.rows < 2) return reject('too few features');

    const matcher = own(new cv.BFMatcher(cv.NORM_HAMMING, false));
    const knn = own(new cv.DMatchVectorVector());
    matcher.knnMatch(descO, descR, knn, 2);
    const src: number[] = [];
    const dst: number[] = [];
    let ratioMatches = 0;
    const tol = o.guessTolerance * Math.hypot(returned.width, returned.height);
    for (let i = 0; i < knn.size(); i++) {
      const pair: CvDMatchVector = knn.get(i);
      try {
        if (pair.size() < 2) continue;
        const best = pair.get(0);
        const second = pair.get(1);
        if (!(best.distance < o.ratio * second.distance)) continue;
        ratioMatches++;
        const p = kpO.get(best.queryIdx).pt;
        const q = kpR.get(best.trainIdx).pt;
        const px = p.x + 0.5;
        const py = p.y + 0.5;
        const qx = q.x + 0.5;
        const qy = q.y + 0.5;
        const g = applyAffine(initial, px, py);
        if (Math.hypot(g.x - qx, g.y - qy) > tol) continue;
        src.push(px, py);
        dst.push(qx, qy);
      } finally {
        pair.delete();
      }
    }
    const n = src.length / 2;
    if (n < Math.max(6, Math.min(o.minInliers, 12))) return reject('too few matches', { matches: ratioMatches });

    const from = own(new cv.Mat(n, 1, cv.CV_32FC2));
    const to = own(new cv.Mat(n, 1, cv.CV_32FC2));
    from.data32F.set(src);
    to.data32F.set(dst);
    const inlierMask = own(new cv.Mat());
    const fit = own(cv.estimateAffine2D(from, to, inlierMask, cv.RANSAC, o.ransacPx, 2000, 0.995, 10));
    if (fit.empty() || fit.rows !== 2 || fit.cols !== 3) return reject('no transform found', { matches: ratioMatches });
    const m = fit.data64F;
    const A: Affine = [m[0], m[1], m[2], m[3], m[4], m[5]];
    if (!A.every(Number.isFinite)) return reject('no transform found', { matches: ratioMatches });

    let inliers = 0;
    let err = 0;
    const flags = inlierMask.data;
    for (let i = 0; i < n; i++) {
      if (!flags[i]) continue;
      inliers++;
      const p = applyAffine(A, src[2 * i], src[2 * i + 1]);
      err += Math.hypot(p.x - dst[2 * i], p.y - dst[2 * i + 1]);
    }
    const residualPx = inliers ? err / inliers / Math.max(1e-9, affineScale(A)) : 0;
    const inlierRatio = ratioMatches ? inliers / ratioMatches : 0;
    const stats = { fitted: A, matches: ratioMatches, inliers, inlierRatio, residualPx };
    if (inliers < o.minInliers) return reject(`only ${inliers} matching features`, stats);
    if (inlierRatio < o.minInlierRatio) return reject(`low inlier ratio ${inlierRatio.toFixed(2)}`, stats);
    const why = implausibility(A, initial, original, returned);
    if (why) return reject(why, stats);
    return { matrix: A, accepted: true, reason: '', ...stats };
  } catch (err) {
    return reject(`alignment error: ${(err as Error)?.message ?? String(err)}`);
  } finally {
    for (const x of owned.reverse()) {
      try {
        x.delete();
      } catch {
        // already freed
      }
    }
  }
}
