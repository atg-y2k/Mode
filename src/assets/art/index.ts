/**
 * Procedural SVG art for built-in assets (plants, light fixtures, decor).
 * Pure string generation — usable in the browser, tests and the server.
 *
 * Style: clean, slightly stylized "architectural illustration" look that sits
 * well on photos — layered organic shapes with 2-3 tones, soft inner shading
 * via gradients, no outlines/strokes heavier than 1px, transparent background.
 * Output is deterministic for a given spec (seeded PRNG).
 */
import type { ArtResult, ArtSpec } from '../../../shared/art';

export declare function renderArt(spec: ArtSpec): ArtResult;

/** Replace the main color of a spec (foliage / finish / color) — used for tinting placed objects. */
export declare function tintArt(spec: ArtSpec, hex: string): ArtSpec;
