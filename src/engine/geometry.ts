/** Small 2D geometry helpers: homographies (perspective), polygons. */
import type { Pt } from '../../shared/types';

/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Homography H with H·src[i] ≅ dst[i] for 4 point pairs. Throws if degenerate. */
export declare function computeHomography(src: readonly Pt[], dst: readonly Pt[]): Mat3;
export declare function invertMat3(m: Mat3): Mat3 | null;
export declare function applyHomography(m: Mat3, p: Pt): Pt;
export declare function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean;
/** Absolute area (shoelace). */
export declare function polygonArea(poly: readonly Pt[]): number;
export declare function distance(a: Pt, b: Pt): number;
export declare function isConvexQuad(q: readonly Pt[]): boolean;
export declare function rotatePoint(p: Pt, center: Pt, degrees: number): Pt;
/** Distance from p to segment ab. */
export declare function distanceToSegment(p: Pt, a: Pt, b: Pt): number;
