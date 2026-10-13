/**
 * Screen-space drawing helpers for the editor overlay. Everything drawn on top
 * of photos uses a light stroke with a dark halo so it reads on any image, in
 * both themes (the stage is always dark).
 */
import type { Pt } from '../../../shared/types';

export const OVERLAY_INK = '#ffffff';
export const OVERLAY_HALO = 'rgba(0, 0, 0, 0.55)';
export const SUBTRACT_INK = '#ff8787';

type Ctx = CanvasRenderingContext2D;

export function tracePolyline(ctx: Ctx, pts: readonly Pt[], close: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (close) ctx.closePath();
}

/** Strokes the current path twice: a wide dark halo, then the colored line. */
export function strokeWithHalo(ctx: Ctx, color = OVERLAY_INK, width = 1.5, dash: number[] = []): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dash);
  ctx.strokeStyle = OVERLAY_HALO;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export function strokeCircle(ctx: Ctx, c: Pt, r: number, color = OVERLAY_INK, width = 1.5, dash: number[] = []): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(0.5, r), 0, Math.PI * 2);
  strokeWithHalo(ctx, color, width, dash);
}

export function strokeLine(ctx: Ctx, a: Pt, b: Pt, color = OVERLAY_INK, width = 1.5, dash: number[] = []): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  strokeWithHalo(ctx, color, width, dash);
}

/** Round knob: filled disc with a white ring and soft shadow. */
export function drawKnob(ctx: Ctx, c: Pt, r: number, fill: string, opts: { ring?: string; hollow?: boolean } = {}): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  if (!opts.hollow) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.ring ?? OVERLAY_INK;
  ctx.stroke();
  ctx.restore();
}

/** Square resize handle centered at `c`. */
export function drawSquareHandle(ctx: Ctx, c: Pt, size: number): void {
  const h = size / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = OVERLAY_INK;
  ctx.fillRect(c.x - h, c.y - h, size, size);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(c.x - h + 0.5, c.y - h + 0.5, size - 1, size - 1);
  ctx.restore();
}

/** Small pill label with text (e.g. measurements). */
export function drawLabel(ctx: Ctx, text: string, at: Pt, opts: { align?: 'center' | 'left'; color?: string } = {}): void {
  ctx.save();
  ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 14;
  const h = 22;
  const x = opts.align === 'left' ? at.x : at.x - w / 2;
  const y = at.y - h / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 11);
  ctx.fill();
  ctx.fillStyle = opts.color ?? OVERLAY_INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, at.y + 0.5);
  ctx.restore();
}

/** Plus / minus glyph used next to the brush cursor. */
export function drawModeGlyph(ctx: Ctx, at: Pt, subtract: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = subtract ? SUBTRACT_INK : OVERLAY_INK;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(at.x - 3.5, at.y);
  ctx.lineTo(at.x + 3.5, at.y);
  if (!subtract) {
    ctx.moveTo(at.x, at.y - 3.5);
    ctx.lineTo(at.x, at.y + 3.5);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawCrosshair(ctx: Ctx, c: Pt, size = 7): void {
  strokeLine(ctx, { x: c.x - size, y: c.y }, { x: c.x + size, y: c.y }, OVERLAY_INK, 1);
  strokeLine(ctx, { x: c.x, y: c.y - size }, { x: c.x, y: c.y + size }, OVERLAY_INK, 1);
}

/** Simple kelvin → display color for light handles (warm amber … cool white). */
export function kelvinSwatch(kelvin: number): string {
  const t = Math.max(0, Math.min(1, (kelvin - 2000) / 5000));
  const warm = [255, 176, 92];
  const cool = [226, 236, 255];
  const c = warm.map((w, i) => Math.round(w + (cool[i] - w) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** '#rrggbb' + alpha → rgba() string (falls back to white for malformed input). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
