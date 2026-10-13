/**
 * View transform for the editor stage: maps photo pixels ↔ screen (CSS) pixels.
 *
 *   screen = photo · scale + (tx, ty)          (relative to the pane's origin)
 *
 * Pure functions only — the StageController owns the mutable state.
 */
import type { Pt } from '../../../shared/types';

export interface View {
  /** CSS px per photo px. */
  scale: number;
  tx: number;
  ty: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

/** Highest zoom (16 screen px per photo px) — enough for pixel-precise mask edits. */
export const MAX_SCALE = 16;

/** Preset zoom levels used by the +/− buttons. */
export const ZOOM_STEPS = [
  0.05, 0.0625, 0.08, 0.1, 0.125, 0.16, 0.2, 0.25, 0.33, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16,
];

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Contain-fit `image` inside `pane` with `padding` CSS px on every side, centered. */
export function fitView(image: Size, pane: Size, padding: number): View {
  const availW = Math.max(1, pane.width - padding * 2);
  const availH = Math.max(1, pane.height - padding * 2);
  const scale = Math.max(1e-4, Math.min(availW / Math.max(1, image.width), availH / Math.max(1, image.height)));
  return {
    scale,
    tx: (pane.width - image.width * scale) / 2,
    ty: (pane.height - image.height * scale) / 2,
  };
}

/** Zoom range: from half the fit scale up to MAX_SCALE (or the fit scale for tiny photos). */
export function scaleLimits(image: Size, pane: Size, padding: number): ScaleLimits {
  const fit = fitView(image, pane, padding).scale;
  return { min: Math.max(0.01, fit * 0.5), max: Math.max(MAX_SCALE, fit) };
}

/** Zoom to `scale` keeping the photo point under (sx, sy) fixed. */
export function zoomAt(view: View, scale: number, sx: number, sy: number): View {
  const k = scale / view.scale;
  return { scale, tx: sx - (sx - view.tx) * k, ty: sy - (sy - view.ty) * k };
}

export function toPhoto(view: View, sx: number, sy: number): Pt {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}

export function toScreen(view: View, px: number, py: number): Pt {
  return { x: px * view.scale + view.tx, y: py * view.scale + view.ty };
}

/**
 * Keeps at least `margin` CSS px of the image inside the pane (or the whole
 * image when it is smaller than the margin), so it can never be lost off-screen.
 */
export function clampPan(view: View, image: Size, pane: Size, margin: number): View {
  const w = image.width * view.scale;
  const h = image.height * view.scale;
  const mx = Math.min(margin, w);
  const my = Math.min(margin, h);
  return {
    scale: view.scale,
    tx: clamp(view.tx, mx - w, pane.width - mx),
    ty: clamp(view.ty, my - h, pane.height - my),
  };
}

/**
 * Two-finger gesture: the photo point that was under the starting midpoint
 * follows the current midpoint while the scale follows the finger distance.
 */
export function pinchView(
  start: View,
  startMid: Pt,
  startDist: number,
  mid: Pt,
  dist: number,
  limits: ScaleLimits,
): View {
  const p = toPhoto(start, startMid.x, startMid.y);
  const scale = clamp(start.scale * (dist / Math.max(1, startDist)), limits.min, limits.max);
  return { scale, tx: mid.x - p.x * scale, ty: mid.y - p.y * scale };
}

/** Next preset zoom level above (dir 1) or below (dir -1) `scale`, within limits. */
export function stepZoom(scale: number, dir: 1 | -1, limits: ScaleLimits): number {
  let next: number;
  if (dir > 0) next = ZOOM_STEPS.find((z) => z > scale * 1.01) ?? limits.max;
  else next = [...ZOOM_STEPS].reverse().find((z) => z < scale * 0.99) ?? limits.min;
  return clamp(next, limits.min, limits.max);
}

/** Wheel delta → multiplicative zoom factor (trackpad pinch arrives as ctrl+wheel). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  const k = pinch ? 0.01 : 0.0015;
  return Math.exp(clamp(-px * k, -1, 1));
}

export interface CompareLayout {
  /** Pane that shows the design (the only pane unless split). */
  design: PaneRect;
  /** Pane that shows the original photo in split mode. */
  original: PaneRect | null;
  orientation: 'horizontal' | 'vertical';
}

/** Split view puts panes side by side on landscape stages and stacked on portrait ones. */
export function layoutPanes(stage: Size, split: boolean, gap = 2): CompareLayout {
  const full: PaneRect = { x: 0, y: 0, width: stage.width, height: stage.height };
  if (!split) return { design: full, original: null, orientation: 'horizontal' };
  if (stage.width >= stage.height * 0.9) {
    const w = Math.max(0, (stage.width - gap) / 2);
    return {
      original: { x: 0, y: 0, width: w, height: stage.height },
      design: { x: w + gap, y: 0, width: w, height: stage.height },
      orientation: 'horizontal',
    };
  }
  const h = Math.max(0, (stage.height - gap) / 2);
  return {
    original: { x: 0, y: 0, width: stage.width, height: h },
    design: { x: 0, y: h + gap, width: stage.width, height: h },
    orientation: 'vertical',
  };
}

/** Which pane a stage point belongs to (points in the gap count as the design pane). */
export function paneAt(layout: CompareLayout, x: number, y: number): { pane: PaneRect; which: 'design' | 'original' } {
  const o = layout.original;
  if (o && x >= o.x && x < o.x + o.width && y >= o.y && y < o.y + o.height) return { pane: o, which: 'original' };
  return { pane: layout.design, which: 'design' };
}
