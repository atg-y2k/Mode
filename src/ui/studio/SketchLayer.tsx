/**
 * Sketch tools drawn over the viewer: the path being drawn (centerline +
 * width band + rubber band to the pointer), the area being outlined (polygon
 * or freehand lasso), and the handles of a path being adjusted (draggable
 * points and a width handle at the near end). Pointer handling lives in the
 * Viewer; handles carry `data-handle` so it can tell them apart.
 */
import type { Pt, ScenePath } from '../../../shared/types';
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
