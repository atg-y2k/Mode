/**
 * The Studio viewer: the photo (or the variation being viewed) on a dark,
 * calm stage with fit / zoom / pan (wheel, pinch, drag, buttons), the scene
 * overlay (click an area to target it, a path to design it), sketch tools
 * (draw a path centerline with a width handle, outline an area), a
 * before/after slider against the original, hold-to-peek, the run progress
 * pill and the info card of the shown variation.
 */
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  Download,
  Eye,
  Lasso,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize,
  PenLine,
  Route,
  ScanEye,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react';
import { SPACE_TYPE_LABELS, type Photo, type Pt, type Space, type Variation } from '../../../shared/types';
import * as runtime from '../../state/runtime';
import { findPhoto, findVariation, useStore } from '../../state/store';
import { cn } from '../common';
import {
  activatePath,
  activeElement,
  addSketchedArea,
  addSketchedPath,
  deleteScenePath,
  downloadVariation,
  movePathPoint,
  setPathWidth,
  stepVariation,
  targetedPathIds,
  targetedZoneIds,
  toggleZoneTarget,
} from './actions';
import { PlantNoteChips, RatingDot } from './Feasibility';
import { cancelRun, generationOfVariation } from './generate';
import { clamp, clampPan, fitView, hitTestScene, simplifyPolyline, toPhoto, zoomAt, type SceneHit, type View } from './geometry';
import { useBlobUrl, useDecodedUrl, useElementSize, useLatest } from './hooks';
import { Popover } from './Popover';
import { decodeHandle, PathHandles, SketchPreview, widthFromHandle, type SketchHandle } from './SketchLayer';
import { runVariations } from './tiles';
import { getRunInfo, useRunInfo } from './runs';
import { setStudioUI, useStudioUI } from './ui';
import { askDelete, compareWithOriginal, moreLikeThis, RefineForm } from './VariationActions';
import { SceneHoverCard, ZoneOverlay } from './ZoneOverlay';

type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; id: number; x: number; y: number }
  | { kind: 'pan'; id: number; x: number; y: number }
  | { kind: 'pinch'; start: View; mid: Pt; dist: number }
  | { kind: 'lasso'; id: number; points: Pt[] }
  | { kind: 'handle'; id: number; handle: SketchHandle; pathId: string }
  | { kind: 'slider'; id: number };

const CLICK_SLOP = 4;

/** Glass chrome on the stage; swallows pointer-downs so they never start a pan or a click on the photo. */
function Chrome({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('absolute z-20 rounded-xl bg-black/50 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md', className)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children,
  disabled,
  onPointerDown,
  onPointerUp,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className={cn(
        'grid size-9 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40',
        active ? 'bg-white text-black' : 'text-white/85 hover:bg-white/15',
      )}
    >
      {children}
    </button>
  );
}

export function Viewer({ photo, space }: { photo: Photo; space: Space | undefined }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stage = useElementSize(stageRef);
  const studio = useStore((s) => s.studio);
  const runs = useStore((s) => s.runs);
  const location = useStore((s) => s.project?.location);
  const project = useStore((s) => s.project);
  const aiEnabled = useStore((s) => s.health?.ai.enabled ?? null);
  const ui = useStudioUI();

  // ------------------------------------------------------------------ images
  const original = useBlobUrl(photo.imageId);
  const originalShown = useDecodedUrl(original.url);
  const variation = findVariation(photo, studio.viewVariationId);
  const variationBlob = useBlobUrl(variation?.imageId ?? null);
  const variationShown = useDecodedUrl(variation ? variationBlob.url : null);
  const [peek, setPeek] = useState(false);
  const showSlider = ui.slider && !!variation;

  // ---------------------------------------------------------------- view
  const padding = stage.width < 640 ? 8 : 28;
  const fit = useMemo(
    () => (stage.width > 0 && stage.height > 0 ? fitView({ width: photo.width, height: photo.height }, stage, padding) : null),
    [photo.width, photo.height, stage, padding],
  );
  const [view, setView] = useState<View | null>(null);
  const fitted = useRef(true);
  useLayoutEffect(() => {
    if (fit && (fitted.current || !view)) setView(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the fit changes
  }, [fit]);
  useLayoutEffect(() => {
    fitted.current = true;
    if (fit) setView(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- new photo: start fitted
  }, [photo.id]);
  const v = view ?? fit;
  const viewRef = useLatest(v);
  const limits = useMemo(() => ({ min: (fit?.scale ?? 1) * 0.5, max: Math.max(4, (fit?.scale ?? 1) * 1.01) }), [fit]);

  const applyView = useCallback(
    (next: View) => {
      fitted.current = false;
      setView(clampPan(next, { width: photo.width, height: photo.height }, stage, 64));
    },
    [photo.width, photo.height, stage],
  );
  const zoomTo = useCallback(
    (scale: number, sx?: number, sy?: number) => {
      const cur = viewRef.current;
      if (!cur) return;
      const s = clamp(scale, limits.min, limits.max);
      applyView(zoomAt(cur, s, sx ?? stage.width / 2, sy ?? stage.height / 2));
    },
    [applyView, limits, stage, viewRef],
  );
  const resetFit = useCallback(() => {
    fitted.current = true;
    if (fit) setView(fit);
  }, [fit]);

  // Wheel / trackpad zoom at the cursor (non-passive so the page doesn't scroll).
  const zoomRef = useLatest(zoomTo);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = viewRef.current;
      if (!cur) return;
      const r = el.getBoundingClientRect();
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const factor = Math.exp(clamp(-px * (e.ctrlKey ? 0.01 : 0.0015), -1, 1));
      zoomRef.current(cur.scale * factor, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewRef, zoomRef]);

  // ---------------------------------------------------------------- scene
  const scene = photo.scene;
  const brief = photo.draft;
  const targetZones = useMemo(() => targetedZoneIds(brief), [brief]);
  const targetPaths = useMemo(() => targetedPathIds(brief), [brief]);
  const openElement = activeElement(photo, studio.activeElementId);
  const editingPath = ui.editingPathId ? scene?.paths.find((p) => p.id === ui.editingPathId) : undefined;
  const sketch = studio.sketch;
  const [hover, setHover] = useState<SceneHit | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [sketchPts, setSketchPts] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const pointers = useRef(new Map<number, Pt>());
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setSketchPts([]);
    setCursor(null);
    if (sketch !== 'none') setStudioUI({ editingPathId: null });
  }, [sketch, photo.id]);
  useEffect(() => {
    if (ui.editingPathId && !editingPath) setStudioUI({ editingPathId: null });
  }, [ui.editingPathId, editingPath]);

  const defaultPathWidth = useMemo(() => {
    const widths = (scene?.paths ?? [])
      .map((p) => p.widthPx)
      .filter((w) => w > 0)
      .sort((a, b) => a - b);
    return widths.length ? widths[Math.floor(widths.length / 2)] : Math.round(photo.width * 0.06);
  }, [scene?.paths, photo.width]);

  const hitAt = useCallback(
    (sx: number, sy: number): SceneHit | null => {
      const cur = viewRef.current;
      if (!cur || !scene) return null;
      const p = toPhoto(cur, sx, sy);
      if (p.x < 0 || p.y < 0 || p.x >= photo.width || p.y >= photo.height) return null;
      // Context zones (sky, street, neighbors) only react once something targets them.
      const zones = scene.zones.filter((z) => z.editable || targetZones.has(z.id));
      return hitTestScene(p, zones, scene.paths, {
        pathSlop: 6 / cur.scale,
        maskAt: (zone, x, y) => {
          const m = zone.maskId ? runtime.getMask(zone.maskId) : undefined;
          if (!m || m.width !== photo.width || m.height !== photo.height) return undefined;
          return m.data[Math.floor(y) * m.width + Math.floor(x)];
        },
      });
    },
    [scene, photo.width, photo.height, viewRef, targetZones],
  );

  // ------------------------------------------------------------- sketching
  const finishSketch = useCallback(
    (pts: Pt[] = sketchPts) => {
      if (sketch === 'path' && pts.length >= 2) {
        const id = addSketchedPath(photo, space, pts, defaultPathWidth);
        useStore.getState().setStudio({ sketch: 'none' });
        if (id) setStudioUI({ editingPathId: id });
        return;
      }
      if (sketch === 'area' && pts.length >= 3) {
        addSketchedArea(photo, space, pts);
        useStore.getState().setStudio({ sketch: 'none' });
        return;
      }
      if (pts.length === 0) useStore.getState().setStudio({ sketch: 'none' });
    },
    [sketch, sketchPts, photo, space, defaultPathWidth],
  );

  const addSketchPoint = (p: Pt) => {
    const cur = viewRef.current;
    if (!cur) return;
    const q = { x: clamp(p.x, 0, photo.width), y: clamp(p.y, 0, photo.height) };
    const last = sketchPts[sketchPts.length - 1];
    if (last && Math.hypot(last.x - q.x, last.y - q.y) * cur.scale < 3) return; // double-click repeats
    if (sketch === 'area' && sketchPts.length >= 3) {
      const first = sketchPts[0];
      if (Math.hypot(first.x - q.x, first.y - q.y) * cur.scale < 10) {
        finishSketch(sketchPts);
        return;
      }
    }
    setSketchPts([...sketchPts, q]);
  };

  // Sketch / path-editing keys run before the Studio's own shortcuts (capture phase).
  const keyState = useLatest({ sketch, sketchPts, editing: ui.editingPathId, finishSketch });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyState.current;
      if (k.sketch === 'none' && !k.editing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (k.sketch !== 'none') {
        if (e.key === 'Enter') k.finishSketch();
        else if (e.key === 'Escape') {
          setSketchPts([]);
          useStore.getState().setStudio({ sketch: 'none' });
        } else if (e.key === 'Backspace' || e.key === 'Delete') setSketchPts((pts) => pts.slice(0, -1));
        else return;
      } else if (e.key === 'Enter' || e.key === 'Escape') setStudioUI({ editingPathId: null });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keyState]);

  // ------------------------------------------------------------- pointers
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const startPinch = () => {
    const cur = viewRef.current;
    const [a, b] = [...pointers.current.values()];
    if (!cur || !a || !b) return;
    gesture.current = { kind: 'pinch', start: cur, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    setDragging(true);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    stageRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const target = e.target as Element;
    const handle = decodeHandle(target.closest('[data-handle]')?.getAttribute('data-handle'));
    if (handle && editingPath) {
      gesture.current = { kind: 'handle', id: e.pointerId, handle, pathId: editingPath.id };
      setDragging(true);
      return;
    }
    if (target.closest('[data-slider]')) {
      gesture.current = { kind: 'slider', id: e.pointerId };
      setDragging(true);
      return;
    }
    if (e.button === 1) {
      gesture.current = { kind: 'pan', id: e.pointerId, x: p.x, y: p.y };
      setDragging(true);
      return;
    }
    gesture.current = { kind: 'press', id: e.pointerId, x: p.x, y: p.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    const cur = viewRef.current;
    if (!cur) return;

    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const anchor = toPhoto(g.start, g.mid.x, g.mid.y);
      const scale = clamp(g.start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.dist)), limits.min, limits.max);
      applyView({ scale, tx: mid.x - anchor.x * scale, ty: mid.y - anchor.y * scale });
      return;
    }
    if (g.kind === 'press' && g.id === e.pointerId) {
      if (Math.hypot(p.x - g.x, p.y - g.y) <= CLICK_SLOP) return;
      if (sketch === 'area' && sketchPts.length === 0) {
        gesture.current = { kind: 'lasso', id: g.id, points: [toPhoto(cur, g.x, g.y), toPhoto(cur, p.x, p.y)] };
        setSketchPts(gesture.current.points);
      } else {
        gesture.current = { kind: 'pan', id: g.id, x: g.x, y: g.y };
      }
      setHover(null);
      setDragging(true);
    }
    const g2 = gesture.current;
    if (g2.kind === 'pan' && g2.id === e.pointerId) {
      applyView({ scale: cur.scale, tx: cur.tx + (p.x - g2.x), ty: cur.ty + (p.y - g2.y) });
      gesture.current = { ...g2, x: p.x, y: p.y };
      return;
    }
    if (g2.kind === 'lasso' && g2.id === e.pointerId) {
      const q = toPhoto(cur, p.x, p.y);
      const last = g2.points[g2.points.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) * cur.scale >= 3) {
        g2.points.push({ x: clamp(q.x, 0, photo.width), y: clamp(q.y, 0, photo.height) });
        setSketchPts([...g2.points]);
      }
      return;
    }
    if (g2.kind === 'handle' && g2.id === e.pointerId) {
      const q = toPhoto(cur, p.x, p.y);
      const pt = { x: clamp(q.x, 0, photo.width), y: clamp(q.y, 0, photo.height) };
      if (g2.handle.kind === 'vertex') movePathPoint(photo.id, g2.pathId, g2.handle.index, pt);
      else {
        const fresh = findPhoto(useStore.getState().project, photo.id)?.photo.scene?.paths.find((x) => x.id === g2.pathId);
        if (fresh) setPathWidth(photo.id, g2.pathId, Math.min(widthFromHandle(fresh, pt), photo.width * 0.5));
      }
      return;
    }
    if (g2.kind === 'slider' && g2.id === e.pointerId) {
      setStudioUI({ sliderPos: clamp((p.x - cur.tx) / (photo.width * cur.scale), 0, 1) });
      return;
    }

    // Hover (mouse / pen without buttons): what's under the pointer.
    if (g2.kind === 'idle' || g2.kind === 'press') {
      if (sketch !== 'none') {
        setCursor(toPhoto(cur, p.x, p.y));
        return;
      }
      if (e.target !== stageRef.current || !studio.showZones || e.pointerType === 'touch') {
        if (hover) setHover(null);
        return;
      }
      const hit = hitAt(p.x, p.y);
      if (hit?.kind !== hover?.kind || hit?.id !== hover?.id) setHover(hit);
      if (hit) setPointer(p);
    }
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    if (stageRef.current?.hasPointerCapture(e.pointerId)) stageRef.current.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) {
        gesture.current = { kind: 'idle' };
        setDragging(false);
      }
      return;
    }
    if ('id' in g && g.id !== e.pointerId) return;
    gesture.current = { kind: 'idle' };
    setDragging(false);
    if (cancelled) return;
    const cur = viewRef.current;
    if (!cur) return;
    if (g.kind === 'lasso') {
      const tol = 1.5 / cur.scale;
      const pts = simplifyPolyline(g.points, tol);
      if (pts.length >= 3) finishSketch(pts);
      else setSketchPts([]);
      return;
    }
    if (g.kind !== 'press') return;
    // A click.
    const p = local(e);
    if (sketch !== 'none') {
      addSketchPoint(toPhoto(cur, p.x, p.y));
      return;
    }
    if (ui.editingPathId) {
      setStudioUI({ editingPathId: null });
      return;
    }
    if (!studio.showZones || e.target !== stageRef.current) return;
    const hit = hitAt(p.x, p.y);
    if (hit?.kind === 'zone') toggleZoneTarget(photo, hit.id);
    else if (hit?.kind === 'path') activatePath(photo, space, hit.id);
  };

  // ------------------------------------------------------------- runs
  const activeRuns = photo.generations.filter((g) => runs[g.id]);
  const rendering = activeRuns.length > 0;
  const shownRun = generationOfVariation(photo, variation?.id);
  const runInfo = useRunInfo(shownRun?.id);
  const siblings = shownRun ? runVariations(shownRun, runInfo ?? getRunInfo(shownRun.id)) : [];
  const position = variation ? siblings.findIndex((x) => x.id === variation.id) : -1;

  // ------------------------------------------------------------- render
  const imgBox = v ? { left: v.tx, top: v.ty, width: photo.width * v.scale, height: photo.height * v.scale } : undefined;
  const dividerX = v ? v.tx + photo.width * v.scale * ui.sliderPos : 0;
  const variationUrl = variationShown.url;
  const cursorStyle = dragging
    ? gesture.current.kind === 'pan'
      ? 'grabbing'
      : undefined
    : sketch !== 'none'
      ? 'crosshair'
      : hover && studio.showZones
        ? 'pointer'
        : v && fit && v.scale > fit.scale * 1.02
          ? 'grab'
          : 'default';
  const hoverTargeted = hover
    ? hover.kind === 'zone'
      ? targetZones.has(hover.id)
      : openElement
        ? openElement.pathIds.includes(hover.id)
        : targetPaths.has(hover.id)
    : false;
  const category = scene ? SPACE_TYPE_LABELS[scene.category] : space ? SPACE_TYPE_LABELS[space.type] : '';

  return (
    <div
      ref={stageRef}
      className="relative h-full w-full select-none overflow-hidden bg-stage"
      style={{ touchAction: 'none', cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e, false)}
      onPointerCancel={(e) => endGesture(e, true)}
      onPointerLeave={() => {
        if (gesture.current.kind === 'idle') {
          setHover(null);
          setCursor(null);
        }
      }}
      onDoubleClick={() => {
        if (sketch !== 'none') finishSketch();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {imgBox && originalShown.url && (
        <img
          src={originalShown.url}
          alt={`${photo.name} — original`}
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={imgBox}
        />
      )}
      {imgBox && variation && variationUrl && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-150"
          style={{ clipPath: showSlider ? `inset(0 0 0 ${Math.max(0, dividerX)}px)` : undefined, opacity: peek ? 0 : 1 }}
        >
          <img src={variationUrl} alt={variation.title} draggable={false} className="absolute max-w-none select-none" style={imgBox} />
        </div>
      )}

      {(!originalShown.url || (variation && variationShown.pending)) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {original.status === 'missing' ? (
            <p className="rounded-lg bg-black/60 px-3 py-2 text-sm text-white/80">This photo is missing from storage.</p>
          ) : (
            <Loader2 className="size-6 animate-spin text-white/60" />
          )}
        </div>
      )}

      {v && (
        <ZoneOverlay
          photo={photo}
          view={v}
          stage={stage}
          showZones={studio.showZones && !peek && sketch === 'none'}
          hover={studio.showZones && !dragging ? hover : null}
          targetZones={targetZones}
          targetPaths={targetPaths}
          focusZoneId={studio.focusZoneId}
          editingPathId={ui.editingPathId}
          rendering={rendering}
          onEditPath={(id) => {
            useStore.getState().setStudio({ sketch: 'none' });
            setStudioUI({ editingPathId: id });
          }}
        />
      )}
      {v && editingPath && editingPath.points.length >= 2 && <PathHandles path={editingPath} view={v} stage={stage} />}
      {v && sketch !== 'none' && (
        <SketchPreview
          mode={sketch}
          points={sketchPts}
          cursor={cursor}
          widthPx={defaultPathWidth}
          view={v}
          stage={stage}
          closeHint={sketch === 'area' && sketchPts.length >= 3 && !!cursor && Math.hypot(cursor.x - sketchPts[0].x, cursor.y - sketchPts[0].y) * v.scale < 10}
        />
      )}
      {v && hover && studio.showZones && !dragging && sketch === 'none' && !peek && (
        <SceneHoverCard
          photo={photo}
          space={space}
          project={project}
          hover={hover}
          view={v}
          stage={stage}
          pointer={pointer}
          targeted={hoverTargeted}
          activeElementLabel={openElement?.label ?? null}
        />
      )}

      {/* Before / after divider */}
      {v && showSlider && (
        <>
          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgb(0_0_0/0.5)]" style={{ left: dividerX - 1 }} />
          <button
            type="button"
            data-slider
            aria-label="Drag to compare with the original"
            className="absolute z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-white text-black shadow-lg focus-visible:outline-2 focus-visible:outline-accent"
            style={{ left: dividerX, top: stage.height / 2 }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                setStudioUI({ sliderPos: clamp(ui.sliderPos + (e.key === 'ArrowLeft' ? -0.05 : 0.05), 0, 1) });
              }
            }}
          >
            <Columns2 className="size-4" />
          </button>
          <span
            className="pointer-events-none absolute top-4 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ left: Math.max(12, Math.min(dividerX - 76, stage.width - 150)) }}
          >
            Original
          </span>
          <span
            className="pointer-events-none absolute top-4 max-w-48 truncate rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ left: Math.min(dividerX + 10, stage.width - 120) }}
          >
            {variation?.optionLabel || variation?.title}
          </span>
        </>
      )}

      {/* What is shown */}
      <Chrome className="top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1 p-1 sm:max-w-[55%]">
        {variation ? (
          <>
            <ToolButton label="Previous variation (←)" onClick={() => stepVariation(photo, -1)} disabled={position <= 0}>
              <ChevronLeft className="size-4" />
            </ToolButton>
            <div className="min-w-0 px-1 text-xs">
              <div className="truncate font-medium">{variation.optionLabel || variation.title}</div>
              <div className="text-[10px] text-white/60">{position >= 0 ? `${position + 1} of ${siblings.length}` : 'Variation'} · Esc for original</div>
            </div>
            <ToolButton label="Next variation (→)" onClick={() => stepVariation(photo, 1)} disabled={position < 0 || position >= siblings.length - 1}>
              <ChevronRight className="size-4" />
            </ToolButton>
          </>
        ) : (
          <div className="px-2 py-1.5 text-xs">
            <span className="font-medium">Original photo</span>
            {category && <span className="text-white/60"> · {category}</span>}
            {scene?.architecture.style && <span className="hidden text-white/60 md:inline"> · {scene.architecture.style}</span>}
          </div>
        )}
      </Chrome>

      {/* Tools */}
      <Chrome className="top-3 right-3 flex flex-col gap-0.5 p-1 sm:flex-row">
        <ToolButton
          label={studio.showZones ? 'Hide areas ( [ or ] )' : 'Show areas ( [ or ] )'}
          active={studio.showZones}
          onClick={() => useStore.getState().setStudio({ showZones: !studio.showZones })}
        >
          <Layers className="size-4" />
        </ToolButton>
        <ToolButton
          label="Draw a path — click along its center"
          active={sketch === 'path'}
          onClick={() => useStore.getState().setStudio({ sketch: sketch === 'path' ? 'none' : 'path', showZones: true })}
        >
          <Route className="size-4" />
        </ToolButton>
        <ToolButton
          label="Outline an area to change"
          active={sketch === 'area'}
          onClick={() => useStore.getState().setStudio({ sketch: sketch === 'area' ? 'none' : 'area', showZones: true })}
        >
          <Lasso className="size-4" />
        </ToolButton>
        {variation && (
          <>
            <div className="mx-0.5 hidden w-px self-stretch bg-white/15 sm:block" />
            <ToolButton label="Before / after slider" active={showSlider} onClick={() => setStudioUI({ slider: !ui.slider, sliderPos: 0.5 })}>
              <Columns2 className="size-4" />
            </ToolButton>
            <ToolButton label="Hold to see the original" active={peek} onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)}>
              <Eye className="size-4" />
            </ToolButton>
          </>
        )}
      </Chrome>

      {/* Zoom */}
      {v && fit && (
        <Chrome className="right-3 bottom-3 flex items-center gap-0.5 p-1">
          <ToolButton label="Zoom out" onClick={() => zoomTo(v.scale / 1.25)} disabled={v.scale <= limits.min * 1.001}>
            <ZoomOut className="size-4" />
          </ToolButton>
          <button
            type="button"
            onClick={resetFit}
            title="Fit to screen"
            className="h-9 min-w-12 rounded-lg px-1 text-xs tabular-nums text-white/85 hover:bg-white/15"
          >
            {Math.round(v.scale * 100)}%
          </button>
          <ToolButton label="Zoom in" onClick={() => zoomTo(v.scale * 1.25)} disabled={v.scale >= limits.max * 0.999}>
            <ZoomIn className="size-4" />
          </ToolButton>
          <ToolButton label="Fit to screen" onClick={resetFit}>
            <Maximize className="size-4" />
          </ToolButton>
        </Chrome>
      )}

      {/* Sketch / adjust hints and run progress */}
      <div className="pointer-events-none absolute top-16 left-1/2 z-20 flex w-[min(34rem,calc(100%-7rem))] -translate-x-1/2 flex-col items-center gap-2">
        {sketch !== 'none' && (
          <SketchHint
            mode={sketch}
            count={sketchPts.length}
            onUndo={() => setSketchPts((pts) => pts.slice(0, -1))}
            onFinish={() => finishSketch()}
            onCancel={() => useStore.getState().setStudio({ sketch: 'none' })}
            target={sketch === 'path' ? (openElement?.label ?? null) : null}
          />
        )}
        {sketch === 'none' && editingPath && (
          <Pill>
            <span className="min-w-0 flex-1 truncate px-1 text-xs">
              Drag the points or the <span className="font-semibold">width handle</span> of “{editingPath.label}”
            </span>
            {editingPath.kind === 'sketch' && (
              <PillButton
                onClick={() => {
                  deleteScenePath(photo, editingPath.id);
                  setStudioUI({ editingPathId: null });
                }}
              >
                <Trash2 className="size-3.5" /> Remove
              </PillButton>
            )}
            <PillButton primary onClick={() => setStudioUI({ editingPathId: null })}>
              <Check className="size-3.5" /> Done
            </PillButton>
          </Pill>
        )}
        {activeRuns.slice(0, 2).map((g) => (
          <RunProgressPill key={g.id} photoId={photo.id} generationId={g.id} plan={g.plan} gridOpen={studio.gridGenerationId === g.id} />
        ))}
        {!scene && sketch === 'none' && activeRuns.length === 0 && (
          <Pill>
            <ScanEye className="size-4 shrink-0 text-white/70" />
            <span className="min-w-0 flex-1 px-1 text-xs text-white/85">
              {aiEnabled === false
                ? 'Scene mapping needs AI — outline the areas to change with the lasso.'
                : 'Not mapped yet — map the scene to pick areas and paths by clicking.'}
            </span>
            {aiEnabled !== false && (
              <PillButton primary onClick={() => useStore.getState().setStudio({ panel: 'scene' })}>
                Map the scene
              </PillButton>
            )}
          </Pill>
        )}
      </div>

      {variation && shownRun && !showSlider && (
        <InfoCard
          photoId={photo.id}
          variation={variation}
          plan={shownRun.plan}
          plantNotes={shownRun.plantNotes ?? []}
          location={location?.climate?.hardinessZone ?? location?.hardinessZone}
        />
      )}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-auto flex w-full items-center gap-1.5 rounded-xl bg-black/60 p-1.5 pl-3 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function PillButton({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-white',
        primary ? 'bg-white text-black hover:bg-white/90' : 'text-white/85 hover:bg-white/15',
      )}
    >
      {children}
    </button>
  );
}

function SketchHint({
  mode,
  count,
  onUndo,
  onFinish,
  onCancel,
  target,
}: {
  mode: 'path' | 'area';
  count: number;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  target: string | null;
}) {
  const canFinish = mode === 'path' ? count >= 2 : count >= 3;
  const text =
    mode === 'path'
      ? count === 0
        ? 'Click where the new path starts, then along its center'
        : 'Keep clicking along the center · double-click or Enter to finish'
      : count === 0
        ? 'Drag around the area, or click its corners'
        : 'Click the first point or press Enter to close the outline';
  return (
    <Pill>
      {mode === 'path' ? <Route className="size-4 shrink-0 text-white/70" /> : <Lasso className="size-4 shrink-0 text-white/70" />}
      <span className="min-w-0 flex-1 px-1 text-xs leading-snug">
        {text}
        {target && <span className="text-white/60"> · for {target}</span>}
      </span>
      {count > 0 && (
        <PillButton onClick={onUndo}>
          <Undo2 className="size-3.5" />
          <span className="sr-only">Undo point</span>
        </PillButton>
      )}
      <PillButton onClick={onCancel}>
        <X className="size-3.5" />
        <span className="sr-only sm:not-sr-only">Cancel</span>
      </PillButton>
      {canFinish && (
        <PillButton primary onClick={onFinish}>
          <Check className="size-3.5" /> Finish
        </PillButton>
      )}
    </Pill>
  );
}

function RunProgressPill({ photoId, generationId, plan, gridOpen }: { photoId: string; generationId: string; plan: string; gridOpen: boolean }) {
  const progress = useStore((s) => s.runs[generationId]);
  if (!progress) return null;
  const finished = progress.done + progress.failed;
  const pct = progress.stage === 'planning' ? 0.06 : 0.1 + 0.9 * (finished / Math.max(1, progress.total));
  const label =
    progress.stage === 'planning'
      ? `Planning ${progress.total} variation${progress.total === 1 ? '' : 's'}…`
      : `Rendering · ${progress.done} of ${progress.total} ready${progress.failed ? ` · ${progress.failed} failed` : ''}`;
  return (
    <Pill>
      <Loader2 className="size-4 shrink-0 animate-spin text-white/80" />
      <div className="min-w-0 flex-1 px-1">
        <div className="text-xs font-medium">{label}</div>
        {plan && (
          <div className="truncate text-[11px] text-white/60" title={plan}>
            {plan}
          </div>
        )}
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-white/85 transition-[width] duration-500" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      </div>
      {!gridOpen && (
        <PillButton onClick={() => useStore.getState().setStudio({ gridGenerationId: generationId })}>
          <LayoutGrid className="size-3.5" />
          <span className="sr-only sm:not-sr-only">Watch</span>
        </PillButton>
      )}
      <PillButton onClick={() => cancelRun(generationId)}>
        <X className="size-3.5" />
        <span className="sr-only">Cancel run</span>
      </PillButton>
      <span className="sr-only" aria-live="polite">
        {label} for photo {photoId}
      </span>
    </Pill>
  );
}

function InfoCard({
  photoId,
  variation,
  plan,
  plantNotes,
  location,
}: {
  photoId: string;
  variation: Variation;
  plan: string;
  plantNotes: NonNullable<Photo['generations'][number]['plantNotes']>;
  location: string | undefined;
}) {
  const expanded = useStudioUI((s) => s.infoExpanded);
  const refineRef = useRef<HTMLButtonElement>(null);
  const [refining, setRefining] = useState(false);
  const issues = plantNotes.filter((n) => n.rating !== 'good').length;
  return (
    <Chrome className="bottom-3 left-3 flex w-[min(25rem,calc(100%-12.5rem))] min-w-60 flex-col gap-1.5 p-2.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setStudioUI({ infoExpanded: !expanded })}
          aria-expanded={expanded}
          title={expanded ? 'Hide the plan and plants' : 'Show the plan and plants'}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
        >
          <ChevronUp className={cn('size-4 shrink-0 text-white/60 transition-transform', !expanded && 'rotate-180')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[15px] leading-tight">{variation.title}</span>
            {!expanded && (plantNotes.length > 0 || variation.optionLabel) && (
              <span className="flex items-center gap-1 text-[11px] text-white/60">
                {variation.optionLabel && variation.optionLabel !== variation.title && <span className="truncate">{variation.optionLabel} ·</span>}
                {plantNotes.length > 0 && (
                  <>
                    {plantNotes.slice(0, 6).map((n) => (
                      <RatingDot key={n.name} rating={n.rating} />
                    ))}
                    <span>
                      {plantNotes.length} plant{plantNotes.length === 1 ? '' : 's'}
                      {issues > 0 ? ` · ${issues} to check` : ' · all suit the spot'}
                    </span>
                  </>
                )}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={variation.favorite ? 'Remove from favorites (F)' : 'Add to favorites (F)'}
          title="Favorite (F)"
          aria-pressed={variation.favorite}
          onClick={() => useStore.getState().toggleFavorite(photoId, variation.id)}
          className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        >
          <Star className={cn('size-4', variation.favorite ? 'fill-gold text-gold' : 'text-white/80')} />
        </button>
      </div>
      {expanded && (
        <div className="flex max-h-[min(16rem,40vh)] flex-col gap-2 overflow-y-auto px-1">
          {variation.optionLabel && variation.optionLabel !== variation.title && (
            <div className="text-[11px] text-white/60">Option: {variation.optionLabel}</div>
          )}
          {plan && <p className="text-xs leading-relaxed text-white/80">{plan}</p>}
          {plantNotes.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Plants{location ? ` · checked for zone ${location}` : ''}</div>
              <PlantNoteChips notes={plantNotes} tone="stage" max={8} />
            </div>
          )}
          <details className="text-[11px] text-white/60">
            <summary className="cursor-pointer select-none hover:text-white/80">Instruction sent to the image model</summary>
            <p className="mt-1 leading-relaxed">{variation.brief}</p>
          </details>
        </div>
      )}
      <div className="-mx-0.5 flex flex-wrap items-center gap-0.5">
        <CardAction label="More like this" onClick={() => moreLikeThis(photoId, variation)}>
          <Sparkles className="size-3.5" /> More like this
        </CardAction>
        <CardAction label="Refine with feedback" onClick={() => setRefining(true)} buttonRef={refineRef}>
          <PenLine className="size-3.5" /> Refine
        </CardAction>
        <span className="flex-1" />
        <CardAction label="Before / after with the original" onClick={() => compareWithOriginal(variation)}>
          <Columns2 className="size-3.5" />
        </CardAction>
        <CardAction label="Download" onClick={() => void downloadVariation(variation)}>
          <Download className="size-3.5" />
        </CardAction>
        <CardAction label="Delete variation" onClick={() => askDelete(photoId, variation)}>
          <Trash2 className="size-3.5" />
        </CardAction>
      </div>
      <Popover anchor={refineRef.current} open={refining} onClose={() => setRefining(false)} prefer="top" align="start" label="Refine variation">
        <RefineForm photoId={photoId} variation={variation} onDone={() => setRefining(false)} />
      </Popover>
    </Chrome>
  );
}

function CardAction({ label, onClick, children, buttonRef }: { label: string; onClick: () => void; children: ReactNode; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}
