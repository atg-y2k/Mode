/**
 * Sketch tools drawn over the viewer: the path being drawn (centerline +
 * width band + rubber band to the pointer), the area being outlined (polygon
 * or freehand lasso), the handles of a path being adjusted (draggable
 * points and a width handle at the near end), and the "Tap to select"
 * selection (on-device masks, their outlines and the clicked points).
 * Pointer handling lives in the Viewer; handles carry `data-handle` so it
 * can tell them apart.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Pt, ScenePath } from '../../../shared/types';
import type { Mask } from '../../engine/types';
import { maskContours } from '../../vision/contours';
import { useTapSelect } from '../../vision/ui/tapSelect';
import { nearEndIndex, normalAt, toScreen, type Size, type View } from './geometry';

export type SketchHandle = { kind: 'vertex'; index: number } | { kind: 'width' };

export function encodeHandle(h: SketchHandle): string {
  return h.kind === 'vertex' ? `vertex:${h.index}` : 'width';
}

export function decodeHandle(value: string | null | undefined): SketchHandle | null {
  if (!value) return null;
  if (value === 'width') return { kind: 'width' };
  const m = /^vertex:(\d+)$/.exec(value);
  return m ? { kind: 'vertex', index: Number(m[1]) } : null;
}

/** Width handle position (photo px): beside the near end, half a path width out along the normal. */
export function widthHandlePoint(path: Pick<ScenePath, 'points' | 'widthPx'>): Pt {
  const i = nearEndIndex(path.points);
  const n = normalAt(path.points, i);
  const p = path.points[i];
  return { x: p.x + (n.x * path.widthPx) / 2, y: p.y + (n.y * path.widthPx) / 2 };
}

/** New width from dragging the width handle to `pt`. */
export function widthFromHandle(path: Pick<ScenePath, 'points'>, pt: Pt): number {
  const i = nearEndIndex(path.points);
  const n = normalAt(path.points, i);
  const p = path.points[i];
  return Math.max(4, Math.abs((pt.x - p.x) * n.x + (pt.y - p.y) * n.y) * 2);
}

const attr = (pts: readonly Pt[], view: View) =>
  pts.map((p) => `${(p.x * view.scale + view.tx).toFixed(1)},${(p.y * view.scale + view.ty).toFixed(1)}`).join(' ');

export function SketchPreview({
  mode,
  points,
  cursor,
  widthPx,
  view,
  stage,
  closeHint,
}: {
  mode: 'path' | 'area';
  points: readonly Pt[];
  cursor: Pt | null;
  widthPx: number;
  view: View;
  stage: Size;
  /** The pointer is on the first point: clicking closes the outline. */
  closeHint: boolean;
}) {
  if (points.length === 0 && !cursor) return null;
  const withCursor = cursor && !closeHint ? [...points, cursor] : points;
  const band = Math.max(4, widthPx * view.scale);
  return (
    <svg className="pointer-events-none absolute inset-0" width={stage.width} height={stage.height} aria-hidden>
      {mode === 'path' && withCursor.length >= 2 && (
        <polyline
          points={attr(withCursor, view)}
          fill="none"
          stroke="white"
          strokeOpacity={0.22}
          strokeWidth={band}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {mode === 'area' && withCursor.length >= 3 && <polygon points={attr(withCursor, view)} fill="var(--accent)" fillOpacity={0.2} stroke="none" />}
      {withCursor.length >= 2 && (
        <>
          <polyline points={attr(withCursor, view)} fill="none" stroke="rgb(0 0 0 / 0.5)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          <polyline
            points={attr(withCursor, view)}
            fill="none"
            stroke="white"
            strokeWidth={2}
            strokeDasharray={mode === 'path' ? '9 6' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {points.map((p, i) => {
        const s = toScreen(view, p.x, p.y);
        const isFirst = i === 0;
        return (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={isFirst && closeHint ? 8 : 4.5}
            fill={isFirst && closeHint ? 'var(--accent)' : 'white'}
            stroke="rgb(0 0 0 / 0.55)"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

/** Draggable handles of a path being adjusted. */
export function PathHandles({ path, view, stage }: { path: ScenePath; view: View; stage: Size }) {
  const near = path.points[nearEndIndex(path.points)];
  const wh = widthHandlePoint(path);
  const nearS = toScreen(view, near.x, near.y);
  const whS = toScreen(view, wh.x, wh.y);
  return (
    <svg className="absolute inset-0 overflow-visible" width={stage.width} height={stage.height} style={{ pointerEvents: 'none' }}>
      <line x1={nearS.x} y1={nearS.y} x2={whS.x} y2={whS.y} stroke="white" strokeWidth={1.5} strokeDasharray="3 3" />
      {path.points.map((p, i) => {
        const s = toScreen(view, p.x, p.y);
        return (
          <circle
            key={i}
            data-handle={encodeHandle({ kind: 'vertex', index: i })}
            cx={s.x}
            cy={s.y}
            r={7}
            fill="white"
            stroke="rgb(0 0 0 / 0.6)"
            strokeWidth={1.5}
            style={{ pointerEvents: 'all', cursor: 'move' }}
          >
            <title>Drag to move this point</title>
          </circle>
        );
      })}
      <g data-handle="width" style={{ pointerEvents: 'all', cursor: 'ew-resize' }}>
        <circle cx={whS.x} cy={whS.y} r={9} fill="var(--accent)" stroke="white" strokeWidth={2} />
        <path
          d={`M${whS.x - 4},${whS.y} h8 M${whS.x - 4},${whS.y} l2,-2 M${whS.x - 4},${whS.y} l2,2 M${whS.x + 4},${whS.y} l-2,-2 M${whS.x + 4},${whS.y} l-2,2`}
          stroke="white"
          strokeWidth={1.5}
          fill="none"
        />
        <title>Drag to set the path width</title>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tap to select
// ---------------------------------------------------------------------------

/** Long edge of the grid the selection is drawn and outlined on (the photo is ≤ 1600 px). */
const TAP_GRID = 800;

/** Union of masks resampled (nearest) onto a grid of at most TAP_GRID px. */
function unionGrid(masks: readonly Mask[], width: number, height: number): { width: number; height: number; data: Uint8Array } | null {
  const usable = masks.filter((m) => m.width > 0 && m.height > 0);
  if (usable.length === 0) return null;
  const k = Math.min(1, TAP_GRID / Math.max(width, height));
  const gw = Math.max(1, Math.round(width * k));
  const gh = Math.max(1, Math.round(height * k));
  const data = new Uint8Array(gw * gh);
  for (const m of usable) {
    const xs = new Int32Array(gw);
    for (let x = 0; x < gw; x++) xs[x] = Math.min(m.width - 1, Math.floor(((x + 0.5) * m.width) / gw));
    for (let y = 0; y < gh; y++) {
      const row = Math.min(m.height - 1, Math.floor(((y + 0.5) * m.height) / gh)) * m.width;
      const out = y * gw;
      for (let x = 0; x < gw; x++) {
        const v = m.data[row + xs[x]];
        if (v > data[out + x]) data[out + x] = v;
      }
    }
  }
  return { width: gw, height: gh, data };
}

function ringsPath(rings: Pt[][], view: View): string {
  return rings
    .map((r) => `M${r.map((p) => `${(p.x * view.scale + view.tx).toFixed(1)},${(p.y * view.scale + view.ty).toFixed(1)}`).join('L')}Z`)
    .join(' ');
}

/**
 * The current tap selection (filled with the accent, white outline) and the
 * hover preview (light fill, dashed outline), plus the clicked points
 * (+ adds, − removes). Pointer-transparent.
 */
export function TapSelectionLayer({ view, stage, photo }: { view: View; stage: Size; photo: Size }) {
  const parts = useTapSelect((s) => s.parts);
  const preview = useTapSelect((s) => s.preview);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selection = useMemo(
    () => unionGrid(parts.flatMap((p) => (p.mask ? [p.mask] : [])), photo.width, photo.height),
    [parts, photo.width, photo.height],
  );
  const hover = useMemo(() => (preview ? unionGrid([preview], photo.width, photo.height) : null), [preview, photo.width, photo.height]);
  const outline = useMemo(
    () => (selection ? maskContours(selection, { tolerancePx: 0.8, minArea: 6, scaleX: photo.width / selection.width, scaleY: photo.height / selection.height }) : []),
    [selection, photo.width, photo.height],
  );
  const hoverOutline = useMemo(
    () => (hover ? maskContours(hover, { tolerancePx: 1, minArea: 6, maxRings: 3, scaleX: photo.width / hover.width, scaleY: photo.height / hover.height }) : []),
    [hover, photo.width, photo.height],
  );

  // Fill: the selection in the accent color, the preview in white.
  useEffect(() => {
    const canvas = canvasRef.current;
    const grid = selection ?? hover;
    if (!canvas || !grid) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(grid.width, grid.height);
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim();
    const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#72b6a0';
    let ar = parseInt(hex.slice(1, 3), 16);
    let ag = parseInt(hex.slice(3, 5), 16);
    let ab = parseInt(hex.slice(5, 7), 16);
    // A dark accent (light theme) would only darken the photo: lift it toward white.
    if (0.2126 * ar + 0.7152 * ag + 0.0722 * ab < 120) {
      ar = Math.round(ar + (255 - ar) * 0.45);
      ag = Math.round(ag + (255 - ag) * 0.45);
      ab = Math.round(ab + (255 - ab) * 0.45);
    }
    const d = img.data;
    if (selection) {
      for (let i = 0; i < selection.data.length; i++) {
        const v = selection.data[i];
        if (!v) continue;
        d[i * 4] = ar;
        d[i * 4 + 1] = ag;
        d[i * 4 + 2] = ab;
        d[i * 4 + 3] = Math.round(v * 0.42);
      }
    }
    if (hover && hover.width === grid.width && hover.height === grid.height) {
      for (let i = 0; i < hover.data.length; i++) {
        const v = hover.data[i];
        if (!v || d[i * 4 + 3]) continue;
        d[i * 4] = 255;
        d[i * 4 + 1] = 255;
        d[i * 4 + 2] = 255;
        d[i * 4 + 3] = Math.round(v * 0.2);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [selection, hover]);

  const points = parts.flatMap((p) => [...p.positive.map((pt) => ({ pt, neg: false })), ...p.negative.map((pt) => ({ pt, neg: true }))]);
  const box = { left: view.tx, top: view.ty, width: photo.width * view.scale, height: photo.height * view.scale };
  return (
    <>
      {(selection || hover) && <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute max-w-none" style={box} />}
      <svg className="pointer-events-none absolute inset-0" width={stage.width} height={stage.height} aria-hidden>
        {hoverOutline.length > 0 && (
          <path d={ringsPath(hoverOutline, view)} fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.5} strokeDasharray="5 4" />
        )}
        {outline.length > 0 && (
          <>
            <path d={ringsPath(outline, view)} fill="none" stroke="rgb(0 0 0 / 0.55)" strokeWidth={4} strokeLinejoin="round" />
            <path d={ringsPath(outline, view)} fill="none" stroke="white" strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {points.map(({ pt, neg }, i) => {
          const s = toScreen(view, pt.x, pt.y);
          return (
            <g key={i} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}>
              <circle r={8} fill={neg ? 'var(--danger)' : 'var(--accent)'} stroke="white" strokeWidth={2} />
              <path d={neg ? 'M-3.5,0 h7' : 'M-3.5,0 h7 M0,-3.5 v7'} stroke="white" strokeWidth={2} strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </>
  );
}
