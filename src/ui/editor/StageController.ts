/**
 * Imperative engine behind the editor stage.
 *
 * Owns the canvases, the view transform (photo px ↔ screen px), the render
 * loop and every pointer / wheel / keyboard interaction. React (Stage.tsx)
 * mounts it and reads a small snapshot (zoom, layout, busy…) through
 * `subscribe` / `getSnapshot`; everything else is read from and written to the
 * zustand store directly, so pointer moves never re-render React.
 *
 * Rendering:
 *  - display canvas: the design (DesignRenderer → off-screen buffer, double
 *    buffered) or the original photo, blitted with the view transform; compare
 *    slider / split are composed here.
 *  - overlay canvas: mask tints & outlines (cached per mask version), handles,
 *    tool feedback (brush cursor, polygon, lasso, loupe, ghost…).
 * Both redraw at most once per animation frame.
 */
import type { AssetDef, Design, Photo, PlacedLight, PlacedObject, Pt, Quad, Region } from '../../../shared/types';
import { renderArt } from '../../assets/art';
import { defaultObjectHeightPx, pxPerFoot } from '../../assetList/area';
import { getAssetImage, peekAssetImage } from '../../engine/assetImages';
import { DesignRenderer } from '../../engine/compositor';
import { computeHomography } from '../../engine/geometry';
import { cloneMask, combineMasks, fillPolygon, maskBounds, stampBrush, strokeBrush, type BrushOptions, type MaskMode } from '../../engine/mask';
import { magicWand, smartBrushStamp, smartBrushStroke, type LabImage, type SmartBrushOptions } from '../../engine/selection';
import type { Lab, Mask } from '../../engine/types';
import { buildRenderContext } from '../../state/renderContext';
import * as runtime from '../../state/runtime';
import { activeDesignOf, findPhoto, replaceMaskPixels, resolveAsset, snapshotMask, useStore, type AppState, type ToolId } from '../../state/store';
import {
  OVERLAY_INK,
  SUBTRACT_INK,
  drawCrosshair,
  drawKnob,
  drawLabel,
  drawModeGlyph,
  drawSquareHandle,
  drawSwatchLabel,
  kelvinSwatch,
  rgbToHex,
  strokeCircle,
  strokeLine,
  strokeWithHalo,
  tracePolyline,
  withAlpha,
} from './drawing';
import {
  angleFromAnchor,
  applyMat3,
  bytesDifferInRect,
  clampToImage,
  clipRect,
  constrainAngle,
  directionDeg,
  dist,
  distToSegment,
  formatFeet,
  hitObject,
  insideImage,
  isConvexQuad,
  isLineBeam,
  lightEnd,
  lightMid,
  lineRadiusKnob,
  objectCorners,
  pointInPolygon,
  polygonArea,
  quadFromRect,
  rotateHandlePos,
  scaledHeight,
  segmentRect,
  snapAngle,
  spotAngleKnob,
  topCenter,
  translateQuad,
  unionRect,
  type IRect,
  type ObjectFrame,
} from './geometry';
import { MaskLayers, asImageData, type MaskEntry } from './maskLayers';
import {
  MASK_TOOLS,
  SHORTCUT_TOOLS,
  activateTool,
  isControlTarget,
  isTypingTarget,
  nextBrushRadius,
  overlayOpen,
  promptForPlacement,
  promptForRegion,
} from './tools';
import {
  clamp,
  clampPan,
  fitView,
  layoutPanes,
  paneAt,
  pinchView,
  scaleLimits,
  stepZoom,
  toPhoto,
  toScreen,
  wheelZoomFactor,
  zoomAt,
  type CompareLayout,
  type PaneRect,
  type ScaleLimits,
  type View,
} from './viewTransform';

// ---------------------------------------------------------------------------
// Tuning (screen CSS px unless noted)
// ---------------------------------------------------------------------------

const HIT_MOUSE = 10;
const HIT_TOUCH = 22;
const SLOP_MOUSE = 3;
const SLOP_TOUCH = 8;
const ROTATE_OFFSET = 32;
const CLOSE_MOUSE = 11;
const CLOSE_TOUCH = 22;
const DOUBLE_TAP_MS = 350;
/** Min interval between runtime.markMaskDirty calls during a brush drag. */
const MASK_DIRTY_INTERVAL_MS = 48;
/** A render taking longer than this shows the "Rendering…" pill. */
const SLOW_RENDER_MS = 280;
const PAN_MARGIN = 48;

const UNIT_SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Decor forms that hang on a wall or lie flat — no contact shadow by default. */
const NO_SHADOW_FORMS = new Set(['rug', 'mirror', 'wall-art', 'house-numbers', 'shutters-pair', 'awning', 'window-box', 'trellis']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationDraft {
  a: Pt;
  b: Pt;
}

export interface StageSnapshot {
  width: number;
  height: number;
  /** CSS px per photo px. */
  scale: number;
  fitted: boolean;
  layout: CompareLayout;
  /** Slider compare divider, 0..1 of the design pane width. */
  compareX: number;
  /** The design buffer holds a finished render. */
  designReady: boolean;
  /** A render has been running for a noticeable time. */
  rendering: boolean;
  renderError: string | null;
  polygonPoints: number;
  /** Blocking work in progress (magic wand, color analysis). */
  busy: string | null;
  calibrationDraft: CalibrationDraft | null;
}

type LightPart = 'move' | 'p1' | 'p2' | 'radius' | 'angle';

type Hit =
  | { kind: 'object'; id: string; mode: 'move' | 'scale' | 'rotate'; corner?: number }
  | { kind: 'light'; id: string; part: LightPart };

interface PointerInfo {
  x: number;
  y: number;
  type: string;
}

interface StrokeGesture {
  kind: 'stroke';
  id: number;
  region: Region;
  mask: Mask;
  before: Uint8Array;
  last: Pt;
  opts: BrushOptions;
  smart: { lab: LabImage; reference: Lab; opts: SmartBrushOptions } | null;
  /** Changed since the last overlay sync. */
  dirty: IRect | null;
  /** Changed since the stroke started. */
  total: IRect | null;
  /** Pixels changed but runtime.markMaskDirty not called yet. */
  pendingDirty: boolean;
  label: string;
}

interface ObjectGesture {
  kind: 'object';
  id: number;
  objectId: string;
  mode: 'move' | 'scale' | 'rotate';
  start: PlacedObject;
  startP: Pt;
  key: string;
  active: boolean;
  changed: boolean;
  sx: number;
  sy: number;
}

interface LightGesture {
  kind: 'light';
  id: number;
  lightId: string;
  part: LightPart;
  start: PlacedLight;
  startP: Pt;
  key: string;
  active: boolean;
  changed: boolean;
  sx: number;
  sy: number;
}

interface PlaneGesture {
  kind: 'plane';
  id: number;
  regionId: string;
  /** 0..3 = a corner, -1 = the whole quad. */
  corner: number;
  startQuad: Quad;
  startP: Pt;
  key: string;
  changed: boolean;
}

interface TapGesture {
  kind: 'tap';
  id: number;
  sx: number;
  sy: number;
  moved: boolean;
  purpose: 'select' | 'wand' | 'polygon' | 'place' | 'empty';
  p: Pt;
  view: View;
}

type Gesture =
  | { kind: 'pan'; id: number; sx: number; sy: number; start: View }
  | TapGesture
  | StrokeGesture
  | { kind: 'lasso'; id: number; region: Region; points: Pt[] }
  | { kind: 'segment'; id: number; a: Pt; b: Pt; purpose: 'calibrate' | 'place-line' }
  | { kind: 'eyedrop'; id: number }
  | ObjectGesture
  | LightGesture
  | PlaneGesture;

interface Pinch {
  pane: PaneRect;
  startView: View;
  startMid: Pt;
  startDist: number;
}

/** Safari's non-standard trackpad pinch events. */
interface GestureLikeEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

function createCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  return c;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasVisual(asset: AssetDef): boolean {
  return !!(asset.art || asset.svg || asset.imageId);
}

function defaultShadow(asset: AssetDef): boolean {
  if (asset.category === 'lighting') return false;
  if (asset.art?.kind === 'decor' && NO_SHADOW_FORMS.has(asset.art.form)) return false;
  return !asset.tags.some((t) => /\b(wall|wall-mounted|flat|rug)\b/i.test(t));
}

function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'object' && b.kind === 'object') return a.id === b.id && a.mode === b.mode && a.corner === b.corner;
  if (a.kind === 'light' && b.kind === 'light') return a.id === b.id && a.part === b.part;
  return false;
}

function cursorForHit(hit: Hit | null): string {
  if (!hit) return 'default';
  if (hit.kind === 'object') {
    if (hit.mode === 'rotate') return 'grab';
    if (hit.mode === 'scale') return hit.corner === 0 || hit.corner === 2 ? 'nwse-resize' : 'nesw-resize';
    return 'move';
  }
  if (hit.part === 'radius') return 'ew-resize';
  if (hit.part === 'angle') return 'crosshair';
  return 'move';
}

function invertMode(m: MaskMode): MaskMode {
  return m === 'add' ? 'erase' : 'add';
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class StageController {
  private readonly host: HTMLElement;
  private readonly display: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly photoId: string;
  private readonly displayCtx: CanvasRenderingContext2D;
  private readonly overlayCtx: CanvasRenderingContext2D;

  private destroyed = false;
  private readonly renderer = new DesignRenderer();
  private readonly layers = new MaskLayers();
  private original: HTMLCanvasElement | null = null;
  private front = createCanvas();
  private back = createCanvas();
  private designReady = false;
  private rendering = false;
  private designDirty = true;
  private slowRender = false;
  private slowTimer = 0;
  private retryTimer = 0;
  private lastRenderMs = 0;
  private lastRenderEnd = 0;
  private renderError: string | null = null;
  private renderErrorNotified = false;
  private loadingPhoto = false;
  private lastInputs: unknown[] = [];
  private lastVersions = '';
  private labReady = false;

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private hostRect: DOMRect | null = null;
  private layout: CompareLayout = layoutPanes({ width: 0, height: 0 }, false);
  private view: View = { scale: 1, tx: 0, ty: 0 };
  private fitted = true;
  private compareX = 0.5;

  private readonly pointers = new Map<number, PointerInfo>();
  private gesture: Gesture | null = null;
  private pinch: Pinch | null = null;
  /** After a pinch, the remaining finger does nothing until lifted. */
  private ignorePointers = false;
  private hover: PointerInfo | null = null;
  private hoverHit: Hit | null = null;
  private coarse = false;
  private spaceDown = false;
  private altDown = false;
  private shiftDown = false;
  private gestureScale = 1;
  private polygon: Pt[] = [];
  private lastTap = { t: 0, x: 0, y: 0 };
  private busy: string | null = null;
  private calibrationDraft: CalibrationDraft | null = null;

  private raf = 0;
  private needsDisplay = true;
  private needsOverlay = true;
  private pendingPatch: (() => void) | null = null;
  private lastMaskDirtyAt = 0;
  private accent = { value: '#72b6a0', at: 0 };
  private readonly anchorCache = new Map<string, number>();
  private readonly loadingAssets = new Set<string>();

  private readonly listeners = new Set<() => void>();
  private snapshot: StageSnapshot;
  private readonly cleanups: (() => void)[] = [];

  constructor(host: HTMLElement, display: HTMLCanvasElement, overlay: HTMLCanvasElement, photoId: string) {
    this.host = host;
    this.display = display;
    this.overlay = overlay;
    this.photoId = photoId;
    const dctx = display.getContext('2d');
    const octx = overlay.getContext('2d');
    if (!dctx || !octx) throw new Error('This browser cannot draw on a canvas.');
    this.displayCtx = dctx;
    this.overlayCtx = octx;
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.snapshot = this.buildSnapshot();

    this.on(host, 'pointerdown', this.onPointerDown as EventListener);
    this.on(host, 'pointermove', this.onPointerMove as EventListener);
    this.on(host, 'pointerup', this.onPointerUp as EventListener);
    this.on(host, 'pointercancel', this.onPointerUp as EventListener);
    this.on(host, 'lostpointercapture', this.onLostCapture as EventListener);
    this.on(host, 'pointerenter', this.onPointerEnter as EventListener);
    this.on(host, 'pointerleave', this.onPointerLeave as EventListener);
    this.on(host, 'wheel', this.onWheel as EventListener, { passive: false });
    this.on(host, 'contextmenu', (e) => e.preventDefault());
    this.on(host, 'gesturestart', this.onGestureStart, { passive: false });
    this.on(host, 'gesturechange', this.onGestureChange, { passive: false });
    this.on(host, 'gestureend', (e) => e.preventDefault(), { passive: false });
    this.on(window, 'keydown', this.onKeyDown as EventListener);
    this.on(window, 'keyup', this.onKeyUp as EventListener);
    this.on(window, 'blur', this.onWindowBlur);
    // DPR can change without a size change (window moved to another display).
    this.on(window, 'resize', () => this.onResize());

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(host);
    this.cleanups.push(() => ro.disconnect());
    this.cleanups.push(useStore.subscribe(this.onStore));

    this.onResize();
    this.captureInputs(useStore.getState());
    this.onToolChanged(null, useStore.getState().tool);
    this.requestFrame();
  }

  // ------------------------------------------------------------------ public

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StageSnapshot => this.snapshot;

  zoomIn(): void {
    this.zoomCentered(stepZoom(this.view.scale, 1, this.limits()));
  }

  zoomOut(): void {
    this.zoomCentered(stepZoom(this.view.scale, -1, this.limits()));
  }

  /** 100 % = one photo pixel per CSS pixel. */
  actualSize(): void {
    this.zoomCentered(1);
  }

  fit(): void {
    const photo = this.getPhoto();
    if (!photo || this.cssW <= 0) return;
    this.view = fitView(photo, this.layout.design, this.padding());
    this.fitted = true;
    this.invalidate();
    this.emit();
  }

  setCompareX(fraction: number): void {
    const f = clamp(fraction, 0, 1);
    if (f === this.compareX) return;
    this.compareX = f;
    this.invalidate();
    this.emit();
  }

  closePolygon(): void {
    if (!this.polygon.length) return;
    const region = this.requireRegion();
    if (!region) return;
    if (this.polygon.length < 3) {
      useStore.getState().notify('Add at least three points to close the shape.', 'info');
      return;
    }
    this.fillRegion(region, this.polygon, this.maskMode(this.altDown), 'Polygon');
    this.resetPolygon();
  }

  undoPolygonPoint(): void {
    if (!this.polygon.length) return;
    this.polygon = this.polygon.slice(0, -1);
    this.needsOverlay = true;
    this.requestFrame();
    this.emit();
  }

  cancelPolygon(): void {
    this.resetPolygon();
  }

  clearCalibrationDraft(): void {
    this.setCalibrationDraft(null);
  }

  retryRender(): void {
    this.renderError = null;
    this.renderErrorNotified = false;
    this.renderer.reset();
    this.emit();
    this.requestDesignRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    const g = this.gesture;
    if (g?.kind === 'stroke') this.finishStroke(g);
    else this.flushPatch();
    this.gesture = null;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.clearTimeout(this.slowTimer);
    window.clearTimeout(this.retryTimer);
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    this.listeners.clear();
    this.renderer.reset();
    this.layers.clear();
    for (const c of [this.front, this.back, this.original]) {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    }
    this.original = null;
  }

  // --------------------------------------------------------------- plumbing

  private on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  private requestFrame(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private invalidate(): void {
    this.needsDisplay = true;
    this.needsOverlay = true;
    this.requestFrame();
  }

  private requestDesignRender(): void {
    this.designDirty = true;
    this.requestFrame();
  }

  private queuePatch(fn: () => void): void {
    this.pendingPatch = fn;
    this.requestFrame();
  }

  private flushPatch(): void {
    const fn = this.pendingPatch;
    this.pendingPatch = null;
    fn?.();
  }

  private buildSnapshot(): StageSnapshot {
    return {
      width: this.cssW,
      height: this.cssH,
      scale: this.view.scale,
      fitted: this.fitted,
      layout: this.layout,
      compareX: this.compareX,
      designReady: this.designReady,
      rendering: this.slowRender,
      renderError: this.renderError,
      polygonPoints: this.polygon.length,
      busy: this.busy,
      calibrationDraft: this.calibrationDraft,
    };
  }

  private emit(): void {
    if (this.destroyed) return;
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    let changed = false;
    for (const k of Object.keys(next) as (keyof StageSnapshot)[]) {
      if (next[k] !== prev[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  private setBusy(label: string | null): void {
    this.busy = label;
    this.emit();
  }

  private setCalibrationDraft(d: CalibrationDraft | null): void {
    this.calibrationDraft = d;
    this.needsOverlay = true;
    this.requestFrame();
    this.emit();
  }

  private resetPolygon(): void {
    if (!this.polygon.length) return;
    this.polygon = [];
    this.needsOverlay = true;
    this.requestFrame();
    this.emit();
  }

  private getPhoto(): Photo | undefined {
    return findPhoto(useStore.getState().project, this.photoId)?.photo;
  }

  private getDesign(): Design | undefined {
    return activeDesignOf(this.getPhoto());
  }

  private selectedRegion(photo = this.getPhoto()): Region | undefined {
    const id = useStore.getState().selection.regionId;
    return photo?.regions.find((r) => r.id === id);
  }

  private requireRegion(): Region | null {
    const r = this.selectedRegion();
    if (!r) {
      promptForRegion();
      return null;
    }
    return r;
  }

  private maskMode(alt: boolean): MaskMode {
    const base = useStore.getState().toolOptions.maskMode;
    return alt ? invertMode(base) : base;
  }

  private accentColor(): string {
    const now = performance.now();
    if (now - this.accent.at > 1000) {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      this.accent = { value: v || this.accent.value, at: now };
    }
    return this.accent.value;
  }

  // ------------------------------------------------------------ store sync

  private onStore = (s: AppState, prev: AppState): void => {
    if (this.destroyed) return;
    let overlay = false;
    if (s.project !== prev.project || s.library !== prev.library || s.maskVersions !== prev.maskVersions) {
      if (!findPhoto(s.project, this.photoId)) return; // photo removed — React unmounts us
      if (this.captureInputs(s)) this.requestDesignRender();
      overlay = true;
    }
    if (s.selection !== prev.selection) {
      overlay = true;
      if (s.selection.regionId !== prev.selection.regionId) {
        this.resetPolygon();
        if (s.tool === 'plane') this.maybeInitPlane();
      }
      if (s.selection.objectId !== prev.selection.objectId || s.selection.lightId !== prev.selection.lightId) this.hoverHit = null;
    }
    if (s.tool !== prev.tool) {
      this.onToolChanged(prev.tool, s.tool);
      overlay = true;
    }
    if (s.toolOptions !== prev.toolOptions || s.placement !== prev.placement || s.pickedColor !== prev.pickedColor) overlay = true;
    if (s.view !== prev.view) {
      if (s.view.compare !== prev.view.compare) this.relayout();
      this.needsDisplay = true;
      overlay = true;
    }
    if (overlay) this.needsOverlay = true;
    if (overlay || this.needsDisplay) this.requestFrame();
  };

  /** True when anything the render depends on changed. */
  private captureInputs(s: AppState): boolean {
    const photo = findPhoto(s.project, this.photoId)?.photo;
    const design = activeDesignOf(photo);
    if (!photo || !design) return false;
    const inputs: unknown[] = [
      design.id,
      design.treatments,
      design.hiddenRegionIds,
      design.objects,
      design.lights,
      design.lighting,
      photo.regions,
      photo.calibration,
      s.library,
    ];
    const versions = photo.regions.map((r) => s.maskVersions[r.maskId] ?? 0).join(',');
    const changed =
      versions !== this.lastVersions || inputs.length !== this.lastInputs.length || inputs.some((v, i) => v !== this.lastInputs[i]);
    this.lastInputs = inputs;
    this.lastVersions = versions;
    return changed;
  }

  private onToolChanged(prev: ToolId | null, next: ToolId): void {
    if (prev !== null && this.gesture) this.cancelGesture();
    if (next !== 'polygon') this.resetPolygon();
    if (next !== 'calibrate' && this.calibrationDraft) this.setCalibrationDraft(null);
    if (next === 'wand' || next === 'smart-brush') this.prewarmLab();
    if (next === 'plane') this.maybeInitPlane();
    this.hoverHit = null;
    this.updateCursor();
  }

  /** The Lab cache takes a moment on large photos — compute it before the first click. */
  private prewarmLab(): void {
    if (this.labReady || !runtime.getPhotoImage(this.photoId)) return;
    this.setBusy('Preparing color selection…');
    window.setTimeout(() => {
      if (this.destroyed) return;
      try {
        runtime.getPhotoLab(this.photoId);
        this.labReady = true;
      } catch (err) {
        // The wand / smart brush report the problem when actually used.
        console.warn('[editor] color analysis failed', err);
      } finally {
        this.setBusy(null);
      }
    }, 40);
  }

  private maybeInitPlane(): void {
    queueMicrotask(() => {
      if (this.destroyed || useStore.getState().tool !== 'plane') return;
      const region = this.selectedRegion();
      if (region && !region.plane) this.ensurePlane(region);
    });
  }

  /** Creates the region's perspective quad from its mask bounds (or a centered default). */
  private ensurePlane(region: Region): Quad | null {
    if (region.plane) return region.plane.quad;
    const photo = this.getPhoto();
    if (!photo) return null;
    const mask = runtime.getMask(region.maskId);
    const b = mask ? maskBounds(mask) : null;
    const rect =
      b && b.w >= 12 && b.h >= 12
        ? b
        : { x: photo.width * 0.25, y: photo.height * 0.4, w: photo.width * 0.5, h: photo.height * 0.4 };
    const quad = quadFromRect(rect);
    useStore.getState().updateRegion(region.id, { plane: { quad } }, {});
    return quad;
  }

  // --------------------------------------------------------------- layout

  private onResize(): void {
    if (this.destroyed) return;
    const rect = this.host.getBoundingClientRect();
    this.hostRect = rect;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    const center = this.paneCenterPhoto();
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    for (const c of [this.display, this.overlay]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.relayout(center);
  }

  /** Photo point at the center of the design pane (null while the stage has no size). */
  private paneCenterPhoto(): Pt | null {
    const p = this.layout.design;
    if (p.width <= 0 || p.height <= 0) return null;
    return toPhoto(this.view, p.width / 2, p.height / 2);
  }

  private relayout(keepCenter?: Pt | null): void {
    const center = keepCenter !== undefined ? keepCenter : this.paneCenterPhoto();
    this.layout = layoutPanes({ width: this.cssW, height: this.cssH }, useStore.getState().view.compare === 'split');
    const photo = this.getPhoto();
    const pane = this.layout.design;
    if (photo && pane.width > 0 && pane.height > 0) {
      if (this.fitted || !center) {
        this.view = fitView(photo, pane, this.padding());
        this.fitted = true;
      } else {
        const l = this.limits();
        const scale = clamp(this.view.scale, l.min, l.max);
        this.view = this.clampView({ scale, tx: pane.width / 2 - center.x * scale, ty: pane.height / 2 - center.y * scale });
      }
    }
    this.invalidate();
    this.emit();
  }

  private padding(): number {
    return this.layout.design.width < 640 ? 12 : 28;
  }

  private limits(): ScaleLimits {
    const photo = this.getPhoto();
    if (!photo) return { min: 0.01, max: 16 };
    return scaleLimits(photo, this.layout.design, this.padding());
  }

  private clampView(v: View): View {
    const photo = this.getPhoto();
    if (!photo) return v;
    return clampPan(v, photo, this.layout.design, PAN_MARGIN);
  }

  private setView(v: View): void {
    this.view = v;
    this.fitted = false;
    this.invalidate();
    this.emit();
  }

  private zoomCentered(scale: number): void {
    const pane = this.layout.design;
    const l = this.limits();
    this.setView(this.clampView(zoomAt(this.view, clamp(scale, l.min, l.max), pane.width / 2, pane.height / 2)));
  }

  private zoomAround(pt: Pt, scale: number): void {
    const { pane } = paneAt(this.layout, pt.x, pt.y);
    const l = this.limits();
    this.setView(this.clampView(zoomAt(this.view, clamp(scale, l.min, l.max), pt.x - pane.x, pt.y - pane.y)));
  }

  private panBy(dx: number, dy: number): void {
    this.setView(this.clampView({ scale: this.view.scale, tx: this.view.tx + dx, ty: this.view.ty + dy }));
  }

  /** Stage point (CSS px relative to the host). */
  private localPoint(e: { clientX: number; clientY: number }): Pt {
    const r = this.hostRect ?? this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Photo coordinates under a stage point (in whichever pane it falls). */
  private photoAt(pt: Pt): Pt {
    const { pane } = paneAt(this.layout, pt.x, pt.y);
    return toPhoto(this.view, pt.x - pane.x, pt.y - pane.y);
  }

  /** Photo → pane-relative screen point. */
  private sp = (p: Pt): Pt => toScreen(this.view, p.x, p.y);

  private slop(pointerType: string): number {
    return pointerType === 'touch' ? SLOP_TOUCH : SLOP_MOUSE;
  }

  // ------------------------------------------------------------- rendering

  private frame = (): void => {
    this.raf = 0;
    if (this.destroyed) return;
    this.flushPatch();
    const g = this.gesture;
    if (g?.kind === 'stroke') this.syncStroke(g, false);
    if (this.designDirty && !this.rendering) this.maybeStartRender();
    if (this.cssW > 0 && this.cssH > 0) {
      if (this.needsDisplay) {
        this.needsDisplay = false;
        this.drawDisplay();
      }
      if (this.needsOverlay) {
        this.needsOverlay = false;
        this.drawOverlay();
      }
    }
  };

  private maybeStartRender(): void {
    if (this.gesture?.kind === 'stroke') {
      // While brushing, keep the stroke responsive: refresh the design preview
      // only every so often (adaptive to how long a render takes).
      const wait = Math.max(140, this.lastRenderMs * 2.5) - (performance.now() - this.lastRenderEnd);
      if (wait > 0) {
        if (!this.retryTimer) {
          this.retryTimer = window.setTimeout(() => {
            this.retryTimer = 0;
            this.requestFrame();
          }, wait);
        }
        return;
      }
    }
    void this.renderDesign();
  }

  private async renderDesign(): Promise<void> {
    const photo = this.getPhoto();
    const design = activeDesignOf(photo);
    if (!photo || !design) return;
    const ctx = buildRenderContext(photo, design);
    if (!ctx) {
      this.ensurePhotoLoaded(photo);
      return;
    }
    const missing = photo.regions.filter((r) => !runtime.getMask(r.maskId));
    if (missing.length) {
      void Promise.all(missing.map((r) => runtime.loadMask(r.maskId, photo.width, photo.height)))
        .then(() => this.requestDesignRender())
        .catch(() => undefined);
    }
    this.rendering = true;
    this.designDirty = false;
    window.clearTimeout(this.slowTimer);
    this.slowTimer = window.setTimeout(() => {
      if (!this.rendering) return;
      this.slowRender = true;
      this.emit();
    }, SLOW_RENDER_MS);
    const t0 = performance.now();
    try {
      await this.renderer.render(ctx, this.back);
      if (this.destroyed) return;
      const done = this.back;
      this.back = this.front;
      this.front = done;
      this.designReady = true;
      this.renderError = null;
      this.renderErrorNotified = false;
      this.needsDisplay = true;
    } catch (err) {
      if (this.destroyed) return;
      console.error('[editor] design render failed', err);
      this.renderError = errorMessage(err) || 'Unknown error';
      if (!this.renderErrorNotified) {
        this.renderErrorNotified = true;
        useStore.getState().notify('This design could not be rendered — showing the original photo.', 'error');
      }
      this.needsDisplay = true;
    } finally {
      if (!this.destroyed) {
        this.lastRenderMs = performance.now() - t0;
        this.lastRenderEnd = performance.now();
        this.rendering = false;
        window.clearTimeout(this.slowTimer);
        this.slowRender = false;
        this.emit();
        this.requestFrame();
      }
    }
  }

  private ensurePhotoLoaded(photo: Photo): void {
    if (this.loadingPhoto) return;
    this.loadingPhoto = true;
    runtime
      .preloadPhoto(photo)
      .then(() => {
        this.loadingPhoto = false;
        this.original = null;
        this.labReady = false;
        this.requestDesignRender();
        this.invalidate();
      })
      .catch((err: unknown) => {
        this.loadingPhoto = false;
        this.renderError = errorMessage(err);
        this.emit();
      });
  }

  private ensureOriginal(): HTMLCanvasElement | null {
    if (this.original) return this.original;
    const img = runtime.getPhotoImage(this.photoId);
    if (!img) {
      const photo = this.getPhoto();
      if (photo) this.ensurePhotoLoaded(photo);
      return null;
    }
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')?.putImageData(asImageData(img), 0, 0);
    this.original = c;
    return c;
  }

  private drawDisplay(): void {
    const ctx = this.displayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.display.width, this.display.height);
    const original = this.ensureOriginal();
    if (!original) return;
    const view = useStore.getState().view;
    const design = this.designReady ? this.front : original;
    const { layout } = this;
    if (layout.original) {
      this.blit(ctx, original, layout.original);
      this.blit(ctx, view.showOriginal ? original : design, layout.design);
      return;
    }
    const pane = layout.design;
    if (view.showOriginal) {
      this.blit(ctx, original, pane);
      return;
    }
    this.blit(ctx, design, pane);
    if (view.compare === 'slider') {
      this.blit(ctx, original, pane, { x: pane.x, y: pane.y, width: pane.width * this.compareX, height: pane.height });
    }
  }

  private blit(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, pane: PaneRect, clip: PaneRect = pane): void {
    const { scale, tx, ty } = this.view;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(clip.x, clip.y, clip.width, clip.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = scale < 2.5;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(pane.x + tx, pane.y + ty);
    ctx.scale(scale, scale);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  // --------------------------------------------------------------- overlay

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const s = useStore.getState();
    const photo = this.getPhoto();
    const design = activeDesignOf(photo);
    if (!photo || !design || s.view.showOriginal) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const panes: { pane: PaneRect; main: boolean }[] = [{ pane: this.layout.design, main: true }];
    if (this.layout.original) panes.push({ pane: this.layout.original, main: false });
    for (const { pane, main } of panes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, pane.y, pane.width, pane.height);
      ctx.clip();
      ctx.translate(pane.x, pane.y);
      if (main) {
        this.drawMasks(ctx, s, photo, design);
        if (s.tool === 'plane') this.drawPlane(ctx, photo);
        if (s.tool === 'calibrate') this.drawCalibration(ctx, photo);
        if (s.tool === 'select') {
          this.drawLights(ctx, s, design);
          this.drawObjectSelection(ctx, s, design, photo);
        }
      }
      this.drawToolFeedback(ctx, s, photo, main);
      ctx.restore();
    }
    if (s.tool === 'eyedropper') this.drawLoupe(ctx, photo);
  }

  private drawMasks(ctx: CanvasRenderingContext2D, s: AppState, photo: Photo, design: Design): void {
    const mode = s.view.masks;
    if (mode === 'none' || !photo.regions.length) return;
    const maskTool = MASK_TOOLS.has(s.tool) || s.tool === 'plane';
    const stroking = this.gesture?.kind === 'stroke';
    const sel = this.selectedRegion(photo);
    ctx.save();
    if (s.view.compare === 'slider' && !this.layout.original) {
      // Keep the "before" side of the slider untouched.
      const cut = this.layout.design.width * this.compareX;
      ctx.beginPath();
      ctx.rect(cut, 0, this.layout.design.width - cut, this.layout.design.height);
      ctx.clip();
    }
    ctx.translate(this.view.tx, this.view.ty);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.imageSmoothingEnabled = this.view.scale < 2;
    if (mode === 'all') {
      const entries: MaskEntry[] = [];
      for (const r of photo.regions) {
        if (r.id === sel?.id) continue;
        const m = runtime.getMask(r.maskId);
        if (m) entries.push({ region: r, mask: m, version: s.maskVersions[r.maskId] ?? 0 });
      }
      const layer = this.layers.othersLayer(entries, photo.width, photo.height, maskTool);
      if (layer) ctx.drawImage(layer, 0, 0);
    }
    if (sel) {
      const m = runtime.getMask(sel.maskId);
      if (m) {
        const v = s.maskVersions[sel.maskId] ?? 0;
        const treated = !!design.treatments[sel.id] && !design.hiddenRegionIds.includes(sel.id);
        // Tint while outlining (or when nothing is applied yet); otherwise just the
        // outline so the finish itself stays visible.
        if (maskTool || !treated || stroking) ctx.drawImage(this.layers.selectedTint(sel, m, v), 0, 0);
        if (!stroking) ctx.drawImage(this.layers.selectedOutline(sel, m, v), 0, 0);
      }
    }
    ctx.restore();
  }

  private knobRadius(): number {
    return this.coarse ? 9 : 6.5;
  }

  private drawObjectSelection(ctx: CanvasRenderingContext2D, s: AppState, design: Design, photo: Photo): void {
    const hoverId = this.hoverHit?.kind === 'object' ? this.hoverHit.id : null;
    const k = this.view.scale;
    for (const o of design.objects) {
      const selected = o.id === s.selection.objectId;
      if (!selected && o.id !== hoverId) continue;
      const geo = this.objectGeo(o);
      if (!geo) continue;
      const corners = objectCorners(o, geo.aspect, geo.anchorY).map(this.sp);
      tracePolyline(ctx, corners, true);
      strokeWithHalo(ctx, OVERLAY_INK, selected ? 1.5 : 1, selected ? [] : [5, 4]);
      if (!selected) continue;
      const top = this.sp(topCenter(o, geo.aspect, geo.anchorY));
      const rot = this.sp(rotateHandlePos(o, geo.aspect, geo.anchorY, ROTATE_OFFSET / k));
      strokeLine(ctx, top, rot, OVERLAY_INK, 1.25);
      drawKnob(ctx, rot, this.knobRadius(), this.accentColor());
      const size = this.coarse ? 14 : 9;
      for (const c of corners) drawSquareHandle(ctx, c, size);
      drawKnob(ctx, this.sp(o), 3.5, OVERLAY_INK);
      const g = this.gesture;
      if (g?.kind === 'object' && g.objectId === o.id && g.active) {
        const ppf = pxPerFoot(photo.calibration);
        const labelAt = { x: (corners[0].x + corners[1].x) / 2, y: Math.min(corners[0].y, corners[1].y, rot.y) - 18 };
        if (g.mode === 'rotate') drawLabel(ctx, `${Math.round(o.rotation)}°`, labelAt);
        else if (g.mode === 'scale' && ppf) drawLabel(ctx, `${formatFeet(o.height / ppf)} tall`, labelAt);
      }
    }
  }

  private drawLights(ctx: CanvasRenderingContext2D, s: AppState, design: Design): void {
    const k = this.view.scale;
    const knobR = this.knobRadius();
    const accent = this.accentColor();
    for (const l of design.lights) {
      const selected = l.id === s.selection.lightId;
      const hovered = this.hoverHit?.kind === 'light' && this.hoverHit.id === l.id;
      const c = this.sp(l);
      const fill = l.on ? kelvinSwatch(l.kelvin) : 'transparent';
      if (isLineBeam(l.beam)) {
        const e = this.sp(lightEnd(l));
        strokeLine(ctx, c, e, OVERLAY_INK, selected ? 1.5 : 1, l.beam === 'string' ? [2, 5] : [6, 4]);
        if (selected) {
          this.traceCapsule(ctx, c, e, l.radius * k);
          strokeWithHalo(ctx, OVERLAY_INK, 1, [5, 4]);
          const rk = this.sp(lineRadiusKnob(l));
          strokeLine(ctx, this.sp(lightMid(l)), rk, OVERLAY_INK, 1, [2, 3]);
          drawKnob(ctx, rk, knobR - 1.5, OVERLAY_INK);
          drawKnob(ctx, this.sp(lightMid(l)), knobR - 1, accent);
        }
        drawKnob(ctx, c, knobR, fill, { hollow: !l.on, ring: selected || hovered ? accent : OVERLAY_INK });
        drawKnob(ctx, e, knobR, fill, { hollow: !l.on, ring: selected || hovered ? accent : OVERLAY_INK });
        continue;
      }
      if (selected) {
        strokeCircle(ctx, c, l.radius * k, OVERLAY_INK, 1, [5, 4]);
        drawKnob(ctx, { x: c.x + l.radius * k, y: c.y }, knobR - 1.5, OVERLAY_INK);
        if (l.beam === 'spot') {
          const a = ((l.angle ?? 90) * Math.PI) / 180;
          const half = (((l.spread ?? 40) / 2) * Math.PI) / 180;
          const r = l.radius * k;
          for (const off of [-half, half]) {
            strokeLine(ctx, c, { x: c.x + Math.cos(a + off) * r, y: c.y + Math.sin(a + off) * r }, OVERLAY_INK, 1, [3, 4]);
          }
          const ak = this.sp(spotAngleKnob(l));
          strokeLine(ctx, c, ak, OVERLAY_INK, 1.5);
          drawKnob(ctx, ak, knobR - 1, accent);
        }
      }
      if (selected || hovered) strokeCircle(ctx, c, knobR + 4, accent, 2);
      drawKnob(ctx, c, knobR, fill, { hollow: !l.on });
      if (!l.on) drawCrosshair(ctx, c, 3);
    }
  }

  private traceCapsule(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, r: number): void {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, ang - Math.PI / 2, ang + Math.PI / 2);
    ctx.arc(a.x, a.y, r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
    ctx.closePath();
  }

  private drawPlane(ctx: CanvasRenderingContext2D, photo: Photo): void {
    const region = this.selectedRegion(photo);
    const plane = region?.plane;
    if (!plane) return;
    const q = plane.quad;
    try {
      const H = computeHomography(UNIT_SQUARE, q);
      const nu = plane.widthFt ? clamp(Math.round(plane.widthFt), 2, 40) : 8;
      const nv = plane.heightFt ? clamp(Math.round(plane.heightFt), 2, 40) : 8;
      ctx.beginPath();
      for (let i = 1; i < nu; i++) {
        const a = this.sp(applyMat3(H, { x: i / nu, y: 0 }));
        const b = this.sp(applyMat3(H, { x: i / nu, y: 1 }));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let j = 1; j < nv; j++) {
        const a = this.sp(applyMat3(H, { x: 0, y: j / nv }));
        const b = this.sp(applyMat3(H, { x: 1, y: j / nv }));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.save();
      ctx.globalAlpha = 0.8;
      strokeWithHalo(ctx, OVERLAY_INK, 0.75);
      ctx.restore();
    } catch {
      // Degenerate quad: outline only.
    }
    const sq = q.map(this.sp);
    tracePolyline(ctx, sq, true);
    ctx.fillStyle = withAlpha(region.color, 0.12);
    ctx.fill();
    strokeWithHalo(ctx, OVERLAY_INK, 2);
    if (plane.widthFt) drawLabel(ctx, formatFeet(plane.widthFt), { x: (sq[0].x + sq[1].x) / 2, y: (sq[0].y + sq[1].y) / 2 - 16 });
    if (plane.heightFt) drawLabel(ctx, formatFeet(plane.heightFt), { x: (sq[1].x + sq[2].x) / 2 + 26, y: (sq[1].y + sq[2].y) / 2 });
    const accent = this.accentColor();
    const r = this.knobRadius() + 1;
    for (const c of sq) drawKnob(ctx, c, r, accent);
  }

  private drawCalibration(ctx: CanvasRenderingContext2D, photo: Photo): void {
    const g = this.gesture;
    const draft = g?.kind === 'segment' && g.purpose === 'calibrate' ? { a: g.a, b: g.b } : this.calibrationDraft;
    const cal = photo.calibration;
    if (cal && !draft) this.drawMeasureLine(ctx, cal.a, cal.b, formatFeet(cal.lengthFt), this.accentColor(), [6, 4]);
    if (draft) this.drawMeasureLine(ctx, draft.a, draft.b, `${Math.round(dist(draft.a, draft.b))} px`, OVERLAY_INK, []);
  }

  private drawMeasureLine(ctx: CanvasRenderingContext2D, pa: Pt, pb: Pt, label: string, color: string, dash: number[]): void {
    const a = this.sp(pa);
    const b = this.sp(pb);
    strokeLine(ctx, a, b, color, 2, dash);
    const len = Math.max(1e-6, dist(a, b));
    const nx = (-(b.y - a.y) / len) * 7;
    const ny = ((b.x - a.x) / len) * 7;
    for (const p of [a, b]) strokeLine(ctx, { x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }, color, 2);
    drawLabel(ctx, label, { x: (a.x + b.x) / 2 + nx * 3, y: (a.y + b.y) / 2 + ny * 3 });
  }

  private drawToolFeedback(ctx: CanvasRenderingContext2D, s: AppState, photo: Photo, main: boolean): void {
    const g = this.gesture;
    const hover = this.hover;
    const hp = hover ? this.photoAt(hover) : null;
    const tool = s.tool;
    if (tool === 'brush' || tool === 'eraser' || tool === 'smart-brush') {
      if (hp && (hover!.type !== 'touch' || g?.kind === 'stroke') && !this.spaceDown && !this.pinch) this.drawBrushCursor(ctx, s, hp);
      return;
    }
    if (tool === 'polygon') {
      this.drawPolygonDraft(ctx, photo, hp && hover!.type !== 'touch' && !this.pinch ? hp : null);
      return;
    }
    if (tool === 'lasso' && g?.kind === 'lasso') {
      const pts = g.points.map(this.sp);
      const color = this.maskMode(this.altDown) === 'erase' ? SUBTRACT_INK : g.region.color;
      if (pts.length > 2) {
        tracePolyline(ctx, pts, true);
        ctx.fillStyle = withAlpha(color, 0.18);
        ctx.fill();
      }
      tracePolyline(ctx, pts, false);
      strokeWithHalo(ctx, color, 2);
      return;
    }
    if (tool === 'place') {
      if (g?.kind === 'segment' && g.purpose === 'place-line') {
        const a = this.sp(g.a);
        const b = this.sp(g.b);
        strokeLine(ctx, a, b, OVERLAY_INK, 2, [6, 4]);
        drawKnob(ctx, a, this.knobRadius(), kelvinSwatch(s.placement?.kind === 'light' ? s.placement.kelvin : 2700));
        drawKnob(ctx, b, this.knobRadius(), kelvinSwatch(s.placement?.kind === 'light' ? s.placement.kelvin : 2700));
        return;
      }
      if (main && hp && hover!.type !== 'touch' && !g) this.drawGhost(ctx, s, photo, hp);
    }
  }

  private drawBrushCursor(ctx: CanvasRenderingContext2D, s: AppState, hp: Pt): void {
    const { brushRadius, brushHardness, maskMode } = s.toolOptions;
    const c = this.sp(hp);
    const r = brushRadius * this.view.scale;
    const subtract = s.tool === 'eraser' ? !this.altDown : (this.altDown ? invertMode(maskMode) : maskMode) === 'erase';
    const color = subtract ? SUBTRACT_INK : OVERLAY_INK;
    strokeCircle(ctx, c, r, color, 1.5);
    if (brushHardness < 0.95 && r > 8) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      strokeCircle(ctx, c, r * Math.max(0.05, brushHardness), color, 1, [2, 3]);
      ctx.restore();
    }
    if (s.tool === 'smart-brush' || r < 8) drawCrosshair(ctx, c, s.tool === 'smart-brush' ? 5 : 7);
    const d = Math.max(r, 6) * Math.SQRT1_2 + 8;
    drawModeGlyph(ctx, { x: c.x + d, y: c.y - d }, subtract);
  }

  private drawPolygonDraft(ctx: CanvasRenderingContext2D, photo: Photo, hp: Pt | null): void {
    if (!this.polygon.length) return;
    const region = this.selectedRegion(photo);
    const subtract = this.maskMode(this.altDown) === 'erase';
    const color = subtract ? SUBTRACT_INK : (region?.color ?? OVERLAY_INK);
    const pts = this.polygon.map(this.sp);
    const last = pts[pts.length - 1];
    let cursor: Pt | null = null;
    if (hp) cursor = this.sp(this.shiftDown ? constrainAngle(this.polygon[this.polygon.length - 1], hp, 45) : hp);
    const closeR = this.coarse ? CLOSE_TOUCH : CLOSE_MOUSE;
    const closable = pts.length >= 3 && !!cursor && dist(cursor, pts[0]) <= closeR;
    const fillPts = cursor && !closable ? [...pts, cursor] : pts;
    if (fillPts.length >= 3) {
      tracePolyline(ctx, fillPts, true);
      ctx.fillStyle = withAlpha(color, 0.16);
      ctx.fill();
    }
    tracePolyline(ctx, pts, false);
    strokeWithHalo(ctx, color, 2);
    if (cursor) strokeLine(ctx, last, closable ? pts[0] : cursor, color, 1.5, [6, 4]);
    pts.forEach((p, i) => {
      if (i === 0) drawKnob(ctx, p, closable ? this.knobRadius() + 3 : this.knobRadius(), closable ? this.accentColor() : OVERLAY_INK);
      else drawKnob(ctx, p, 3.5, OVERLAY_INK);
    });
  }

  private drawGhost(ctx: CanvasRenderingContext2D, s: AppState, photo: Photo, hp: Pt): void {
    const pl = s.placement;
    if (!pl) return;
    const at = clampToImage(hp, photo.width, photo.height);
    const c = this.sp(at);
    const k = this.view.scale;
    if (pl.kind === 'object') {
      const asset = resolveAsset(pl.assetId);
      if (!asset) return;
      const h = this.defaultHeight(asset, photo) * k;
      const w = h * (asset.aspect > 0 ? asset.aspect : 1);
      const anchorY = this.anchorOf(asset);
      const img = this.peekImage(asset);
      ctx.save();
      ctx.globalAlpha = 0.6;
      if (img) ctx.drawImage(img, c.x - w / 2, c.y - anchorY * h, w, h);
      ctx.restore();
      if (!img) {
        tracePolyline(
          ctx,
          [
            { x: c.x - w / 2, y: c.y - anchorY * h },
            { x: c.x + w / 2, y: c.y - anchorY * h },
            { x: c.x + w / 2, y: c.y + (1 - anchorY) * h },
            { x: c.x - w / 2, y: c.y + (1 - anchorY) * h },
          ],
          true,
        );
        strokeWithHalo(ctx, OVERLAY_INK, 1, [5, 4]);
      }
      drawKnob(ctx, c, 3.5, OVERLAY_INK);
      return;
    }
    const preview = this.newLight(pl, at, null, photo);
    const r = preview.radius * k;
    const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(1, r));
    const tone = kelvinSwatch(pl.kelvin);
    glow.addColorStop(0, tone.replace('rgb(', 'rgba(').replace(')', ', 0.45)'));
    glow.addColorStop(1, tone.replace('rgb(', 'rgba(').replace(')', ', 0)'));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
    strokeCircle(ctx, c, r, OVERLAY_INK, 1, [5, 4]);
    drawKnob(ctx, c, this.knobRadius(), tone);
  }

  private drawLoupe(ctx: CanvasRenderingContext2D, photo: Photo): void {
    const hover = this.hover;
    if (!hover || this.pinch || this.spaceDown) return;
    if (hover.type === 'touch' && this.gesture?.kind !== 'eyedrop') return;
    const original = this.ensureOriginal();
    if (!original) return;
    const p = this.photoAt(hover);
    if (!insideImage(p, photo.width, photo.height)) return;
    const R = this.coarse ? 60 : 52;
    const N = 11;
    const offset = hover.type === 'touch' ? R + 44 : R + 26;
    let cy = hover.y - offset;
    if (cy - R < 6) cy = hover.y + offset;
    const cx = clamp(hover.x, R + 6, Math.max(R + 6, this.cssW - R - 6));
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    const sx = clamp(px - (N >> 1), 0, Math.max(0, original.width - N));
    const sy = clamp(py - (N >> 1), 0, Math.max(0, original.height - N));
    const cell = (2 * R) / N;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(original, sx, sy, N, N, cx - R, cy - R, 2 * R, 2 * R);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - R + (px - sx) * cell, cy - R + (py - sy) * cell, cell, cell);
    ctx.restore();
    strokeCircle(ctx, { x: cx, y: cy }, R, OVERLAY_INK, 3);
    const hex = this.sampleColor(p);
    if (hex) drawSwatchLabel(ctx, hex, { x: cx, y: cy + R + 18 });
  }

  // ------------------------------------------------------- assets & lights

  private anchorOf(asset: AssetDef): number {
    const cached = this.anchorCache.get(asset.id);
    if (cached !== undefined) return cached;
    let a = 1;
    if (asset.art) {
      try {
        const r = renderArt(asset.art);
        if (r.anchorY > 0 && r.anchorY <= 1) a = r.anchorY;
      } catch {
        // fall back to the bottom edge
      }
    }
    this.anchorCache.set(asset.id, a);
    return a;
  }

  private objectGeo(o: PlacedObject): { aspect: number; anchorY: number } | null {
    const asset = resolveAsset(o.assetId);
    if (!asset) return null;
    return { aspect: asset.aspect > 0 ? asset.aspect : 1, anchorY: this.anchorOf(asset) };
  }

  /** Where the fixture art of a light is drawn (emitter aligned to the light point). */
  private fixtureFrame(l: PlacedLight): { frame: ObjectFrame; aspect: number } | null {
    if (!l.showFixture || !l.assetId) return null;
    const asset = resolveAsset(l.assetId);
    if (!asset || !hasVisual(asset)) return null;
    const emitterY = asset.light?.emitterY ?? 0.5;
    const size = l.fixtureSize;
    return {
      frame: { x: l.x, y: l.y + (1 - emitterY) * size, height: size, rotation: 0 },
      aspect: asset.aspect > 0 ? asset.aspect : 1,
    };
  }

  private peekImage(asset: AssetDef): CanvasImageSource | null {
    try {
      const img = peekAssetImage(asset);
      if (img) return img;
    } catch {
      return null;
    }
    if (!this.loadingAssets.has(asset.id)) {
      this.loadingAssets.add(asset.id);
      getAssetImage(asset)
        .then(() => {
          this.needsOverlay = true;
          this.requestFrame();
        })
        .catch(() => undefined);
    }
    return null;
  }

  private defaultHeight(asset: AssetDef, photo: Photo): number {
    let h = NaN;
    try {
      h = defaultObjectHeightPx(asset, photo);
    } catch {
      // fall through to the heuristic
    }
    if (!Number.isFinite(h) || h <= 0) h = photo.height * 0.15;
    return clamp(h, 8, photo.height * 2);
  }

  private newLight(
    pl: Extract<AppState['placement'], { kind: 'light' }>,
    at: Pt,
    end: Pt | null,
    photo: Photo,
  ): Omit<PlacedLight, 'id'> {
    const asset = pl.assetId ? resolveAsset(pl.assetId) : undefined;
    const info = asset?.light;
    const ppf = pxPerFoot(photo.calibration);
    const line = isLineBeam(pl.beam);
    const maxR = Math.max(photo.width, photo.height) * 2;
    const radius = clamp(info && ppf ? info.reachFt * ppf : photo.width * 0.22, 12, maxR);
    const fixtureSize = clamp(asset && ppf ? asset.realHeightFt * ppf : photo.height * 0.08, 8, photo.height * 0.6);
    const light: Omit<PlacedLight, 'id'> = {
      assetId: asset?.id ?? pl.assetId,
      name: pl.name || asset?.name || 'Light',
      x: at.x,
      y: at.y,
      beam: pl.beam,
      radius,
      intensity: 1,
      kelvin: pl.kelvin,
      on: true,
      showFixture: !!asset && hasVisual(asset),
      fixtureSize,
    };
    if (pl.beam === 'spot') {
      // Landscape spots sit on the ground and aim up; mounted spots aim down.
      const mount = info?.mountHeightFt ?? (info && info.outdoor && !info.indoor ? 0 : 8);
      light.angle = mount <= 2 ? -90 : 90;
      light.spread = 40;
    }
    if (line) {
      const e = clampToImage(end ?? { x: at.x + photo.width * 0.2, y: at.y }, photo.width, photo.height);
      light.x2 = e.x;
      light.y2 = e.y;
    }
    return light;
  }

  private sampleColor(p: Pt): string | null {
    const img = runtime.getPhotoImage(this.photoId);
    if (!img) return null;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    if (cx < 0 || cy < 0 || cx >= img.width || cy >= img.height) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = cy - 1; y <= cy + 1; y++) {
      if (y < 0 || y >= img.height) continue;
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x < 0 || x >= img.width) continue;
        const i = (y * img.width + x) * 4;
        r += img.data[i];
        g += img.data[i + 1];
        b += img.data[i + 2];
        n++;
      }
    }
    return n ? rgbToHex(r / n, g / n, b / n) : null;
  }

  private regionAt(p: Pt, photo: Photo): Region | undefined {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= photo.width || y >= photo.height) return undefined;
    for (let i = photo.regions.length - 1; i >= 0; i--) {
      const r = photo.regions[i];
      const m = runtime.getMask(r.maskId);
      if (m && m.width === photo.width && m.data[y * m.width + x] >= 128) return r;
    }
    return undefined;
  }

  // ----------------------------------------------------------- hit testing

  private hitTest(p: Pt, coarse: boolean): Hit | null {
    const s = useStore.getState();
    const design = this.getDesign();
    if (!design) return null;
    const k = this.view.scale;
    const tol = (coarse ? HIT_TOUCH : HIT_MOUSE) / k;
    const selObj = design.objects.find((o) => o.id === s.selection.objectId);
    if (selObj) {
      const g = this.objectGeo(selObj);
      if (g) {
        const corners = objectCorners(selObj, g.aspect, g.anchorY);
        let best = -1;
        let bestD = tol;
        corners.forEach((c, i) => {
          const d = dist(p, c);
          if (d <= bestD) {
            best = i;
            bestD = d;
          }
        });
        if (best >= 0) return { kind: 'object', id: selObj.id, mode: 'scale', corner: best };
        if (dist(p, rotateHandlePos(selObj, g.aspect, g.anchorY, ROTATE_OFFSET / k)) <= tol) {
          return { kind: 'object', id: selObj.id, mode: 'rotate' };
        }
      }
    }
    const selLight = design.lights.find((l) => l.id === s.selection.lightId);
    if (selLight) {
      const part = this.hitLight(selLight, p, tol, true);
      if (part) return { kind: 'light', id: selLight.id, part };
    }
    // Light handles are small, explicit targets: they win over object rects.
    for (let i = design.lights.length - 1; i >= 0; i--) {
      const l = design.lights[i];
      const part = this.hitLight(l, p, tol, false);
      if (part) return { kind: 'light', id: l.id, part };
    }
    const sorted = [...design.objects].sort((a, b) => b.z - a.z);
    for (const o of sorted) {
      const g = this.objectGeo(o);
      if (g && hitObject(p, o, g.aspect, g.anchorY, 2 / k)) return { kind: 'object', id: o.id, mode: 'move' };
    }
    for (let i = design.lights.length - 1; i >= 0; i--) {
      const l = design.lights[i];
      const f = this.fixtureFrame(l);
      if (f && hitObject(p, f.frame, f.aspect, 1, 2 / k)) return { kind: 'light', id: l.id, part: 'move' };
    }
    return null;
  }

  private hitLight(l: PlacedLight, p: Pt, tol: number, selected: boolean): LightPart | null {
    const c = { x: l.x, y: l.y };
    if (isLineBeam(l.beam)) {
      const e = lightEnd(l);
      if (dist(p, e) <= tol) return 'p2';
      if (dist(p, c) <= tol) return 'p1';
      if (selected) {
        if (dist(p, lineRadiusKnob(l)) <= tol) return 'radius';
        if (dist(p, lightMid(l)) <= tol) return 'move';
      }
      return distToSegment(p, c, e) <= tol * 0.5 ? 'move' : null;
    }
    if (dist(p, c) <= tol) return 'move';
    if (selected) {
      if (l.beam === 'spot' && dist(p, spotAngleKnob(l)) <= tol) return 'angle';
      if (dist(p, { x: l.x + l.radius, y: l.y }) <= tol) return 'radius';
      if (Math.abs(dist(p, c) - l.radius) <= tol * 0.6) return 'radius';
    }
    return null;
  }

  private updateHover(): void {
    const s = useStore.getState();
    const h = this.hover;
    let hit: Hit | null = null;
    if (h && s.tool === 'select' && !this.spaceDown && !this.gesture) hit = this.hitTest(this.photoAt(h), h.type === 'touch');
    if (!sameHit(hit, this.hoverHit)) {
      this.hoverHit = hit;
      this.needsOverlay = true;
    }
    this.updateCursor();
  }

  private planeHoverCursor(): string {
    const h = this.hover;
    const region = this.selectedRegion();
    if (!h || !region?.plane) return 'crosshair';
    const p = this.photoAt(h);
    const tol = (h.type === 'touch' ? HIT_TOUCH : HIT_MOUSE) / this.view.scale;
    if (region.plane.quad.some((c) => dist(p, c) <= tol)) return 'move';
    return pointInPolygon(p, region.plane.quad) ? 'grab' : 'crosshair';
  }

  private updateCursor(): void {
    const s = useStore.getState();
    const g = this.gesture;
    let c: string;
    if (this.pinch || g?.kind === 'pan') c = 'grabbing';
    else if (this.spaceDown || s.tool === 'pan') c = 'grab';
    else {
      switch (s.tool) {
        case 'select':
          c = g?.kind === 'object' || g?.kind === 'light' ? (g.kind === 'object' && g.mode === 'rotate' ? 'grabbing' : 'move') : cursorForHit(this.hoverHit);
          break;
        case 'brush':
        case 'eraser':
        case 'smart-brush':
          c = this.hover?.type === 'mouse' && s.toolOptions.brushRadius * this.view.scale >= 4 ? 'none' : 'crosshair';
          break;
        case 'plane':
          c = g?.kind === 'plane' ? (g.corner >= 0 ? 'move' : 'grabbing') : this.planeHoverCursor();
          break;
        default:
          c = 'crosshair';
      }
    }
    if (this.host.style.cursor !== c) this.host.style.cursor = c;
  }

  // -------------------------------------------------------------- pointers

  private onPointerEnter = (e: PointerEvent): void => {
    this.hostRect = this.host.getBoundingClientRect();
    if (e.pointerType === 'mouse') this.coarse = false;
  };

  private onPointerLeave = (): void => {
    if (this.gesture) return;
    this.hover = null;
    this.hoverHit = null;
    this.needsOverlay = true;
    this.requestFrame();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.destroyed) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    this.hostRect = this.host.getBoundingClientRect();
    const pt = this.localPoint(e);
    this.pointers.set(e.pointerId, { x: pt.x, y: pt.y, type: e.pointerType });
    this.coarse = e.pointerType === 'touch';
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
    if (document.activeElement !== this.host) this.host.focus({ preventScroll: true });
    e.preventDefault();
    if (e.pointerType === 'touch' && this.pointers.size >= 2) {
      if (this.gesture) this.cancelGesture();
      this.startPinch();
      return;
    }
    if (this.pinch || this.ignorePointers || this.gesture || this.pointers.size > 1) return;
    this.altDown = e.altKey;
    this.shiftDown = e.shiftKey;
    this.hover = { x: pt.x, y: pt.y, type: e.pointerType };
    if (e.button === 1 || this.spaceDown || useStore.getState().tool === 'pan') {
      this.gesture = { kind: 'pan', id: e.pointerId, sx: pt.x, sy: pt.y, start: this.view };
    } else {
      this.beginTool(e, pt);
    }
    this.updateCursor();
    this.needsOverlay = true;
    this.requestFrame();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed) return;
    const pt = this.localPoint(e);
    const info = this.pointers.get(e.pointerId);
    if (info) {
      info.x = pt.x;
      info.y = pt.y;
    }
    if (this.pinch) {
      this.updatePinch();
      return;
    }
    if (this.ignorePointers) return;
    this.altDown = e.altKey;
    this.shiftDown = e.shiftKey;
    const g = this.gesture;
    if (!g) {
      if (e.pointerType === 'touch') return;
      this.hover = { x: pt.x, y: pt.y, type: e.pointerType };
      this.updateHover();
      this.needsOverlay = true;
      this.requestFrame();
      return;
    }
    if (g.id !== e.pointerId) return;
    this.hover = { x: pt.x, y: pt.y, type: e.pointerType };
    this.moveGesture(g, e, pt);
    this.needsOverlay = true;
    this.requestFrame();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.destroyed) return;
    const pt = this.localPoint(e);
    this.pointers.delete(e.pointerId);
    try {
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (e.pointerType === 'touch') this.hover = null;
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null;
        this.ignorePointers = this.pointers.size > 0;
        this.updateCursor();
      }
      return;
    }
    if (this.ignorePointers) {
      if (this.pointers.size === 0) this.ignorePointers = false;
      return;
    }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    if (e.type === 'pointercancel') this.cancelGesture();
    else this.endGesture(g, e, pt);
    this.updateCursor();
    this.needsOverlay = true;
    this.requestFrame();
  };

  private onLostCapture = (e: PointerEvent): void => {
    // Capture lost without a pointerup (element hidden, OS gesture…): abort.
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    if (this.gesture?.id === e.pointerId) this.cancelGesture();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.pinch || this.destroyed) return;
    this.hostRect = this.host.getBoundingClientRect();
    const pt = this.localPoint(e);
    const pinch = e.ctrlKey || e.metaKey;
    if (!pinch && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
      this.panBy(-e.deltaX, -e.deltaY);
      return;
    }
    this.zoomAround(pt, this.view.scale * wheelZoomFactor(e.deltaY, e.deltaMode, pinch));
  };

  private onGestureStart = (e: Event): void => {
    e.preventDefault();
    this.gestureScale = this.view.scale;
  };

  private onGestureChange = (e: Event): void => {
    e.preventDefault();
    if (this.pointers.size > 0) return; // touch pinch is handled with pointer events
    const g = e as GestureLikeEvent;
    if (!Number.isFinite(g.scale)) return;
    this.hostRect = this.host.getBoundingClientRect();
    this.zoomAround(this.localPoint(g), this.gestureScale * g.scale);
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { pane } = paneAt(this.layout, mid.x, mid.y);
    this.pinch = {
      pane,
      startView: this.view,
      startMid: { x: mid.x - pane.x, y: mid.y - pane.y },
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
    this.hover = null;
    this.updateCursor();
    this.needsOverlay = true;
    this.requestFrame();
  }

  private updatePinch(): void {
    const p = this.pinch;
    const pts = [...this.pointers.values()];
    if (!p || pts.length < 2) return;
    const [a, b] = pts;
    const mid = { x: (a.x + b.x) / 2 - p.pane.x, y: (a.y + b.y) / 2 - p.pane.y };
    const v = pinchView(p.startView, p.startMid, p.startDist, mid, Math.hypot(a.x - b.x, a.y - b.y), this.limits());
    this.setView(this.clampView(v));
  }

  // -------------------------------------------------------------- gestures

  private beginTool(e: PointerEvent, pt: Pt): void {
    const s = useStore.getState();
    const photo = this.getPhoto();
    if (!photo || !this.getDesign()) return;
    const p = this.photoAt(pt);
    const id = e.pointerId;
    const tap = (purpose: TapGesture['purpose']): TapGesture => ({
      kind: 'tap',
      id,
      sx: pt.x,
      sy: pt.y,
      moved: false,
      purpose,
      p,
      view: this.view,
    });
    switch (s.tool) {
      case 'select': {
        const hit = this.hitTest(p, e.pointerType === 'touch');
        if (hit) this.beginHit(hit, id, pt, p);
        else this.gesture = tap('select');
        break;
      }
      case 'brush':
      case 'eraser':
      case 'smart-brush':
        this.beginStroke(id, p, s.tool, e.altKey);
        break;
      case 'wand':
      case 'polygon':
        if (this.requireRegion()) this.gesture = tap(s.tool);
        break;
      case 'lasso': {
        const region = this.requireRegion();
        if (region) this.gesture = { kind: 'lasso', id, region, points: [p] };
        break;
      }
      case 'eyedropper':
        this.gesture = { kind: 'eyedrop', id };
        break;
      case 'calibrate':
        this.setCalibrationDraft(null);
        this.gesture = { kind: 'segment', id, a: p, b: p, purpose: 'calibrate' };
        break;
      case 'plane':
        this.beginPlane(id, pt, p, e.pointerType === 'touch');
        break;
      case 'place': {
        const pl = s.placement;
        if (!pl) {
          promptForPlacement();
          s.setTool('select');
          break;
        }
        if (pl.kind === 'light' && isLineBeam(pl.beam)) {
          const a = clampToImage(p, photo.width, photo.height);
          this.gesture = { kind: 'segment', id, a, b: a, purpose: 'place-line' };
        } else this.gesture = tap('place');
        break;
      }
      case 'pan':
        break;
    }
  }

  private beginHit(hit: Hit, id: number, pt: Pt, p: Pt): void {
    const s = useStore.getState();
    const design = this.getDesign();
    if (!design) return;
    const stamp = Date.now();
    if (hit.kind === 'object') {
      const o = design.objects.find((x) => x.id === hit.id);
      if (!o) return;
      if (s.selection.objectId !== o.id || s.selection.lightId) s.select({ objectId: o.id, lightId: null, regionId: null });
      this.gesture = {
        kind: 'object',
        id,
        objectId: o.id,
        mode: hit.mode,
        start: { ...o },
        startP: p,
        key: `editor:object:${hit.mode}:${o.id}:${stamp}`,
        active: hit.mode !== 'move',
        changed: false,
        sx: pt.x,
        sy: pt.y,
      };
      return;
    }
    const l = design.lights.find((x) => x.id === hit.id);
    if (!l) return;
    if (s.selection.lightId !== l.id || s.selection.objectId) s.select({ lightId: l.id, objectId: null, regionId: null });
    this.gesture = {
      kind: 'light',
      id,
      lightId: l.id,
      part: hit.part,
      start: { ...l },
      startP: p,
      key: `editor:light:${hit.part}:${l.id}:${stamp}`,
      active: hit.part !== 'move',
      changed: false,
      sx: pt.x,
      sy: pt.y,
    };
  }

  private beginStroke(id: number, p: Pt, tool: 'brush' | 'eraser' | 'smart-brush', alt: boolean): void {
    const region = this.requireRegion();
    const photo = this.getPhoto();
    if (!region || !photo) return;
    const mask = runtime.getMask(region.maskId);
    if (!mask) {
      void runtime
        .loadMask(region.maskId, photo.width, photo.height)
        .then(() => this.requestDesignRender())
        .catch(() => undefined);
      useStore.getState().notify('Loading this surface — try again in a moment.', 'info');
      return;
    }
    const before = snapshotMask(region.maskId);
    if (!before) return;
    const s = useStore.getState();
    // Make sure the tint layer exists so the stroke can update it incrementally.
    this.layers.selectedTint(region, mask, s.maskVersions[region.maskId] ?? 0);
    const base: MaskMode = tool === 'eraser' ? 'erase' : s.toolOptions.maskMode;
    const mode = alt ? invertMode(base) : base;
    const opts: BrushOptions = { radius: s.toolOptions.brushRadius, hardness: s.toolOptions.brushHardness, mode };
    let smart: StrokeGesture['smart'] = null;
    if (tool === 'smart-brush') {
      const lab = runtime.getPhotoLab(this.photoId);
      if (!lab) {
        s.notify('The photo is still loading — try again in a moment.', 'info');
        return;
      }
      this.labReady = true;
      const sOpts: SmartBrushOptions = { ...opts, tolerance: s.toolOptions.smartTolerance };
      const reference = smartBrushStamp(lab, mask, p.x, p.y, sOpts);
      smart = { lab, reference, opts: sOpts };
    } else {
      stampBrush(mask, p.x, p.y, opts);
    }
    const r = segmentRect(p, p, opts.radius + 2);
    const label = tool === 'eraser' ? 'Erase' : tool === 'smart-brush' ? 'Smart brush' : mode === 'erase' ? 'Brush (subtract)' : 'Brush';
    this.gesture = { kind: 'stroke', id, region, mask, before, last: p, opts, smart, dirty: r, total: r, pendingDirty: false, label };
  }

  private beginPlane(id: number, pt: Pt, p: Pt, coarse: boolean): void {
    const region = this.requireRegion();
    if (!region) return;
    const quad = region.plane?.quad ?? this.ensurePlane(region);
    if (!quad) return;
    const tol = (coarse ? HIT_TOUCH : HIT_MOUSE) / this.view.scale;
    let corner = -2;
    let best = tol;
    quad.forEach((c, i) => {
      const d = dist(p, c);
      if (d <= best) {
        best = d;
        corner = i;
      }
    });
    if (corner < 0 && pointInPolygon(p, quad)) corner = -1;
    if (corner === -2) {
      this.gesture = { kind: 'tap', id, sx: pt.x, sy: pt.y, moved: false, purpose: 'empty', p, view: this.view };
      return;
    }
    this.gesture = {
      kind: 'plane',
      id,
      regionId: region.id,
      corner,
      startQuad: quad,
      startP: p,
      key: `editor:plane:${region.id}:${Date.now()}`,
      changed: false,
    };
  }

  private moveGesture(g: Gesture, e: PointerEvent, pt: Pt): void {
    switch (g.kind) {
      case 'pan':
        this.setView(this.clampView({ scale: this.view.scale, tx: g.start.tx + pt.x - g.sx, ty: g.start.ty + pt.y - g.sy }));
        return;
      case 'tap': {
        if (!g.moved && Math.hypot(pt.x - g.sx, pt.y - g.sy) > this.slop(e.pointerType)) {
          g.moved = true;
          if (g.purpose === 'select' || g.purpose === 'empty') {
            // Dragging empty space pans the photo.
            const pan: Gesture = { kind: 'pan', id: g.id, sx: g.sx, sy: g.sy, start: g.view };
            this.gesture = pan;
            this.updateCursor();
            this.moveGesture(pan, e, pt);
            return;
          }
        }
        g.p = this.photoAt(pt);
        return;
      }
      case 'stroke':
        for (const ev of this.coalesced(e)) this.strokeTo(g, this.photoAt(this.localPoint(ev)));
        return;
      case 'lasso': {
        const minStep = 1.5 / this.view.scale;
        for (const ev of this.coalesced(e)) {
          const q = this.photoAt(this.localPoint(ev));
          if (dist(q, g.points[g.points.length - 1]) >= minStep) g.points.push(q);
        }
        return;
      }
      case 'segment': {
        const photo = this.getPhoto();
        let b = this.photoAt(pt);
        if (e.shiftKey) b = constrainAngle(g.a, b, 45);
        if (g.purpose === 'place-line' && photo) b = clampToImage(b, photo.width, photo.height);
        g.b = b;
        return;
      }
      case 'eyedrop':
        return;
      case 'object':
        this.moveObject(g, this.photoAt(pt), pt, e);
        return;
      case 'light':
        this.moveLight(g, this.photoAt(pt), pt, e);
        return;
      case 'plane':
        this.movePlane(g, this.photoAt(pt));
        return;
    }
  }

  private coalesced(e: PointerEvent): PointerEvent[] {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    return list.length ? list : [e];
  }

  private strokeTo(g: StrokeGesture, q: Pt): void {
    if (q.x === g.last.x && q.y === g.last.y) return;
    if (g.smart) smartBrushStroke(g.smart.lab, g.mask, g.last, q, g.smart.opts, g.smart.reference);
    else strokeBrush(g.mask, g.last, q, g.opts);
    const r = segmentRect(g.last, q, g.opts.radius + 2);
    g.dirty = unionRect(g.dirty, r);
    g.total = unionRect(g.total, r);
    g.last = q;
  }

  /** Push stroke pixels to the overlay (every frame) and to the store (throttled). */
  private syncStroke(g: StrokeGesture, final: boolean): void {
    if (g.dirty) {
      const r = clipRect(g.dirty, g.mask.width, g.mask.height);
      if (r) this.layers.updateSelectedRect(g.region, g.mask, r);
      g.dirty = null;
      g.pendingDirty = true;
      this.needsOverlay = true;
    }
    if (!g.pendingDirty) return;
    const now = performance.now();
    if (final || now - this.lastMaskDirtyAt >= MASK_DIRTY_INTERVAL_MS) {
      g.pendingDirty = false;
      this.lastMaskDirtyAt = now;
      runtime.markMaskDirty(g.region.maskId);
      this.layers.syncSelectedVersion(g.region.maskId, useStore.getState().maskVersions[g.region.maskId] ?? 0);
    } else {
      this.requestFrame();
    }
  }

  private finishStroke(g: StrokeGesture): void {
    this.syncStroke(g, true);
    const after = snapshotMask(g.region.maskId);
    const r = g.total ? clipRect(g.total, g.mask.width, g.mask.height) : null;
    if (after && r && bytesDifferInRect(g.before, after, g.mask.width, r)) {
      useStore.getState().recordMaskEdit(g.region.maskId, g.before, after, g.label);
    }
    this.requestDesignRender();
  }

  private moveObject(g: ObjectGesture, p: Pt, pt: Pt, e: PointerEvent): void {
    if (!g.active) {
      if (Math.hypot(pt.x - g.sx, pt.y - g.sy) <= this.slop(e.pointerType)) return;
      g.active = true;
    }
    const photo = this.getPhoto();
    if (!photo) return;
    const st = g.start;
    const anchor = { x: st.x, y: st.y };
    let patch: Partial<PlacedObject>;
    if (g.mode === 'move') {
      patch = { x: clamp(st.x + p.x - g.startP.x, 0, photo.width), y: clamp(st.y + p.y - g.startP.y, 0, photo.height) };
    } else if (g.mode === 'scale') {
      patch = { height: scaledHeight(anchor, g.startP, p, st.height, 4, photo.height * 3) };
    } else {
      const delta = angleFromAnchor(anchor, p) - angleFromAnchor(anchor, g.startP);
      patch = { rotation: snapAngle(st.rotation + delta, e.shiftKey) };
    }
    const { objectId, key } = g;
    this.queuePatch(() => {
      g.changed = true;
      useStore.getState().updateObject(objectId, patch, { coalesce: key });
    });
  }

  private moveLight(g: LightGesture, p: Pt, pt: Pt, e: PointerEvent): void {
    if (!g.active) {
      if (Math.hypot(pt.x - g.sx, pt.y - g.sy) <= this.slop(e.pointerType)) return;
      g.active = true;
    }
    const photo = this.getPhoto();
    if (!photo) return;
    const st = g.start;
    const c = { x: st.x, y: st.y };
    const end = lightEnd(st);
    const line = isLineBeam(st.beam);
    const W = photo.width;
    const H = photo.height;
    let patch: Partial<PlacedLight>;
    switch (g.part) {
      case 'move': {
        const dx = p.x - g.startP.x;
        const dy = p.y - g.startP.y;
        patch = { x: clamp(st.x + dx, 0, W), y: clamp(st.y + dy, 0, H) };
        if (line) {
          patch.x2 = clamp(end.x + dx, 0, W);
          patch.y2 = clamp(end.y + dy, 0, H);
        }
        break;
      }
      case 'p1': {
        const q = clampToImage(e.shiftKey ? constrainAngle(end, p, 45) : p, W, H);
        patch = { x: q.x, y: q.y };
        break;
      }
      case 'p2': {
        const q = clampToImage(e.shiftKey ? constrainAngle(c, p, 45) : p, W, H);
        patch = { x2: q.x, y2: q.y };
        break;
      }
      case 'radius': {
        const r = line ? distToSegment(p, c, end) : dist(p, c);
        patch = { radius: clamp(r, 6, Math.max(W, H) * 2) };
        break;
      }
      case 'angle':
        patch = { angle: snapAngle(directionDeg(c, p), e.shiftKey) };
        break;
    }
    const { lightId, key } = g;
    this.queuePatch(() => {
      g.changed = true;
      useStore.getState().updateLight(lightId, patch, { coalesce: key });
    });
  }

  private movePlane(g: PlaneGesture, p: Pt): void {
    const photo = this.getPhoto();
    if (!photo) return;
    let q: Quad;
    if (g.corner >= 0) {
      // Corners may sit outside the frame (planes often extend past the photo edge).
      const c = { x: clamp(p.x, -photo.width, photo.width * 2), y: clamp(p.y, -photo.height, photo.height * 2) };
      q = g.startQuad.map((pt, i) => (i === g.corner ? c : pt)) as Quad;
    } else {
      q = translateQuad(g.startQuad, p.x - g.startP.x, p.y - g.startP.y);
    }
    if (!isConvexQuad(q)) return;
    const { regionId, key } = g;
    this.queuePatch(() => {
      const region = this.getPhoto()?.regions.find((r) => r.id === regionId);
      if (!region) return;
      g.changed = true;
      useStore.getState().updateRegion(regionId, { plane: { ...region.plane, quad: q } }, { coalesce: key });
    });
  }

  private endGesture(g: Gesture, e: PointerEvent, pt: Pt): void {
    this.gesture = null;
    const p = this.photoAt(pt);
    switch (g.kind) {
      case 'pan':
        break;
      case 'tap':
        this.endTap(g, e, p);
        break;
      case 'stroke':
        if (e.pointerType !== 'touch') this.strokeTo(g, p);
        this.finishStroke(g);
        break;
      case 'lasso': {
        const pts = g.points;
        if (pts.length >= 3 && polygonArea(pts) * this.view.scale * this.view.scale >= 24) {
          this.fillRegion(g.region, pts, this.maskMode(e.altKey), 'Lasso');
        }
        break;
      }
      case 'segment': {
        const screenLen = dist(g.a, g.b) * this.view.scale;
        if (g.purpose === 'calibrate') {
          if (screenLen >= 8) this.setCalibrationDraft({ a: g.a, b: g.b });
          else useStore.getState().notify('Drag along something whose length you know — a door, a tile, a fence panel.', 'info');
        } else {
          this.placeAt(g.a, screenLen >= 12 ? g.b : null, e.shiftKey);
        }
        break;
      }
      case 'eyedrop': {
        const hex = this.sampleColor(p);
        if (hex) useStore.getState().setPickedColor(hex);
        break;
      }
      case 'object':
      case 'light':
      case 'plane':
        this.flushPatch();
        break;
    }
  }

  private endTap(g: TapGesture, e: PointerEvent, p: Pt): void {
    switch (g.purpose) {
      case 'select':
        if (!g.moved) this.selectAt(p);
        break;
      case 'wand':
        if (!g.moved) this.runWand(p, e.shiftKey ? 'replace' : this.maskMode(e.altKey));
        break;
      case 'polygon':
        if (!g.moved || e.pointerType !== 'touch') this.polygonTap(p, e);
        break;
      case 'place':
        this.placeAt(p, null, e.shiftKey);
        break;
      case 'empty':
        break;
    }
  }

  private cancelGesture(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    this.pendingPatch = null;
    const s = useStore.getState();
    switch (g.kind) {
      case 'stroke':
        g.mask.data.set(g.before);
        runtime.markMaskDirty(g.region.maskId);
        break;
      case 'object':
        if (g.changed) {
          const { x, y, height, rotation } = g.start;
          s.updateObject(g.objectId, { x, y, height, rotation }, { coalesce: g.key });
        }
        break;
      case 'light':
        if (g.changed) {
          const { x, y, x2, y2, radius, angle } = g.start;
          s.updateLight(g.lightId, { x, y, x2, y2, radius, angle }, { coalesce: g.key });
        }
        break;
      case 'plane':
        if (g.changed) {
          const region = this.getPhoto()?.regions.find((r) => r.id === g.regionId);
          if (region) s.updateRegion(g.regionId, { plane: { ...region.plane, quad: g.startQuad } }, { coalesce: g.key });
        }
        break;
      default:
        break;
    }
    this.updateCursor();
    this.invalidate();
  }

  // ----------------------------------------------------------- tool actions

  private selectAt(p: Pt): void {
    const s = useStore.getState();
    const photo = this.getPhoto();
    if (!photo) return;
    const region = this.regionAt(p, photo);
    s.select({ regionId: region?.id ?? null, objectId: null, lightId: null });
  }

  private fillRegion(region: Region, pts: Pt[], mode: MaskMode, label: string): void {
    const mask = runtime.getMask(region.maskId);
    if (!mask) {
      useStore.getState().notify('This surface is still loading — try again in a moment.', 'info');
      return;
    }
    const next = cloneMask(mask);
    fillPolygon(next, pts, mode);
    replaceMaskPixels(region.maskId, next.data, mode === 'erase' ? `${label} (subtract)` : label);
  }

  private polygonTap(p: Pt, e: PointerEvent): void {
    const pts = this.polygon;
    const k = this.view.scale;
    const closeR = (e.pointerType === 'touch' ? CLOSE_TOUCH : CLOSE_MOUSE) / k;
    if (pts.length >= 3 && dist(p, pts[0]) <= closeR) {
      this.closePolygon();
      return;
    }
    const now = performance.now();
    if (pts.length && now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 10) {
      // Double click / double tap closes (the first click already added the point).
      this.lastTap = { t: 0, x: 0, y: 0 };
      if (pts.length >= 3) this.closePolygon();
      return;
    }
    const q = e.shiftKey && pts.length ? constrainAngle(pts[pts.length - 1], p, 45) : p;
    this.polygon = [...pts, q];
    this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    this.emit();
  }

  private runWand(p: Pt, mode: MaskMode | 'replace'): void {
    const region = this.requireRegion();
    const photo = this.getPhoto();
    if (!region || !photo || !insideImage(p, photo.width, photo.height)) return;
    this.setBusy(this.labReady ? 'Selecting similar colors…' : 'Analyzing colors…');
    // Let the busy pill paint before the (synchronous) flood fill runs.
    window.setTimeout(() => {
      if (this.destroyed) return;
      try {
        const lab = runtime.getPhotoLab(this.photoId);
        const mask = runtime.getMask(region.maskId);
        if (!lab || !mask) throw new Error('the photo is still loading');
        this.labReady = true;
        const { wandTolerance, wandContiguous } = useStore.getState().toolOptions;
        const sel = magicWand(lab, { x: Math.floor(p.x), y: Math.floor(p.y) }, { tolerance: wandTolerance, contiguous: wandContiguous });
        let next: Mask;
        if (mode === 'replace') next = sel;
        else {
          next = cloneMask(mask);
          combineMasks(next, sel, mode === 'add' ? 'union' : 'subtract');
        }
        replaceMaskPixels(region.maskId, next.data, mode === 'erase' ? 'Magic wand (subtract)' : 'Magic wand');
      } catch (err) {
        useStore.getState().notify(`Magic wand failed: ${errorMessage(err)}`, 'error');
      } finally {
        this.setBusy(null);
      }
    }, 30);
  }

  private placeAt(p: Pt, end: Pt | null, keepArmed: boolean): void {
    const s = useStore.getState();
    const pl = s.placement;
    const photo = this.getPhoto();
    if (!pl || !photo) return;
    const at = clampToImage(p, photo.width, photo.height);
    if (pl.kind === 'object') {
      const asset = resolveAsset(pl.assetId);
      if (!asset) {
        s.notify('That item is no longer available — pick another one in the Library.', 'error');
        s.setPlacement(null);
        return;
      }
      s.addObject({
        assetId: asset.id,
        x: at.x,
        y: at.y,
        height: this.defaultHeight(asset, photo),
        rotation: 0,
        flipX: false,
        opacity: 1,
        shadow: defaultShadow(asset),
      });
    } else {
      s.addLight(this.newLight(pl, at, end, photo));
    }
    // Shift keeps the placement armed for planting rows / several fixtures.
    if (!keepArmed) useStore.getState().setPlacement(null);
  }

  // -------------------------------------------------------------- keyboard

  private editorHasFocus(): boolean {
    const a = document.activeElement;
    if (!a || a === document.body) return true;
    const root = this.host.closest('[data-editor-root]') ?? this.host;
    return root.contains(a);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.destroyed || e.defaultPrevented) return;
    if (overlayOpen() || isTypingTarget(e.target)) return;
    const s = useStore.getState();
    if (e.key === 'Alt') {
      this.altDown = true;
      this.needsOverlay = true;
      this.requestFrame();
      e.preventDefault();
      return;
    }
    if (e.key === 'Shift') {
      this.shiftDown = true;
      this.needsOverlay = true;
      this.requestFrame();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    // Arrows / Enter / Space / Delete belong to a focused control; act only when
    // the canvas (or nothing in particular) has focus.
    const onControl = e.target !== this.host && isControlTarget(e.target);
    if (e.key === ' ' && !mod) {
      // Space activates buttons, tabs, menu items…; anywhere else it means "pan".
      const t = e.target;
      if (t instanceof HTMLElement && t !== this.host && t.closest('button, a[href], select, [role="tab"], [role="radio"], [role="switch"], [role="menuitem"], [role="slider"]:not(input)')) return;
      e.preventDefault();
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.hoverHit = null;
        this.updateCursor();
        this.needsOverlay = true;
        this.requestFrame();
      }
      return;
    }
    if (mod) {
      if (e.altKey) return;
      switch (e.key) {
        case '0':
          this.fit();
          break;
        case '1':
          this.actualSize();
          break;
        case '=':
        case '+':
          this.zoomIn();
          break;
        case '-':
        case '_':
          this.zoomOut();
          break;
        case 'd':
        case 'D':
          if (!this.duplicateSelection()) return;
          break;
        default:
          return;
      }
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const focusHere = this.editorHasFocus() && !onControl;
    const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const tool = SHORTCUT_TOOLS[lower];
    if (tool) {
      if (!e.repeat) activateTool(tool);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case '[':
      case ']': {
        const r = nextBrushRadius(s.toolOptions.brushRadius, e.key === ']' ? 1 : -1);
        s.setToolOptions({ brushRadius: r });
        e.preventDefault();
        return;
      }
      case 'Escape':
        if (this.handleEscape()) e.preventDefault();
        return;
      case 'Enter':
        if (focusHere && s.tool === 'polygon' && this.polygon.length) {
          this.closePolygon();
          e.preventDefault();
        }
        return;
      case 'Backspace':
      case 'Delete':
        if (!focusHere) return;
        if (s.tool === 'polygon' && this.polygon.length) {
          this.undoPolygonPoint();
          e.preventDefault();
          return;
        }
        if (this.deleteSelection()) e.preventDefault();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!focusHere) return;
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        this.nudge(dx, dy, e.shiftKey);
        e.preventDefault();
        return;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Alt') {
      this.altDown = false;
      this.needsOverlay = true;
      this.requestFrame();
    } else if (e.key === 'Shift') {
      this.shiftDown = false;
      this.needsOverlay = true;
      this.requestFrame();
    } else if (e.key === ' ') {
      if (this.spaceDown) {
        this.spaceDown = false;
        this.updateHover();
        this.needsOverlay = true;
        this.requestFrame();
      }
    }
  };

  private onWindowBlur = (): void => {
    this.spaceDown = false;
    this.altDown = false;
    this.shiftDown = false;
    this.updateCursor();
  };

  private handleEscape(): boolean {
    if (this.gesture) {
      this.cancelGesture();
      return true;
    }
    if (this.polygon.length) {
      this.resetPolygon();
      return true;
    }
    if (this.calibrationDraft) {
      this.setCalibrationDraft(null);
      return true;
    }
    const s = useStore.getState();
    if (s.tool === 'place') {
      s.setPlacement(null);
      return true;
    }
    if (s.selection.objectId || s.selection.lightId) {
      s.select({ objectId: null, lightId: null });
      return true;
    }
    if (s.tool !== 'select') {
      s.setTool('select');
      return true;
    }
    return false;
  }

  private deleteSelection(): boolean {
    const s = useStore.getState();
    const design = this.getDesign();
    if (!design) return false;
    const { objectId, lightId } = s.selection;
    if (objectId && design.objects.some((o) => o.id === objectId)) {
      s.deleteObject(objectId);
      return true;
    }
    if (lightId && design.lights.some((l) => l.id === lightId)) {
      s.deleteLight(lightId);
      return true;
    }
    return false;
  }

  private duplicateSelection(): boolean {
    const s = useStore.getState();
    const design = this.getDesign();
    if (!design) return false;
    const { objectId, lightId } = s.selection;
    if (objectId && design.objects.some((o) => o.id === objectId)) {
      s.duplicateObject(objectId);
      return true;
    }
    const l = design.lights.find((x) => x.id === lightId);
    if (l) {
      const { id: _id, ...rest } = l;
      const off = 24 / this.view.scale;
      s.addLight({
        ...rest,
        x: l.x + off,
        y: l.y + off,
        x2: l.x2 !== undefined ? l.x2 + off : undefined,
        y2: l.y2 !== undefined ? l.y2 + off : undefined,
      });
      return true;
    }
    return false;
  }

  private nudge(dx: number, dy: number, big: boolean): void {
    const s = useStore.getState();
    const design = this.getDesign();
    if (!design) return;
    const step = big ? 10 : 1;
    const o = design.objects.find((x) => x.id === s.selection.objectId);
    if (o) {
      s.updateObject(o.id, { x: o.x + dx * step, y: o.y + dy * step }, { coalesce: `editor:nudge:${o.id}` });
      return;
    }
    const l = design.lights.find((x) => x.id === s.selection.lightId);
    if (l) {
      const patch: Partial<PlacedLight> = { x: l.x + dx * step, y: l.y + dy * step };
      if (isLineBeam(l.beam)) {
        const e = lightEnd(l);
        patch.x2 = e.x + dx * step;
        patch.y2 = e.y + dy * step;
      }
      s.updateLight(l.id, patch, { coalesce: `editor:nudge:${l.id}` });
      return;
    }
    // Nothing selected: arrows pan the view.
    this.panBy(-dx * (big ? 160 : 40), -dy * (big ? 160 : 40));
  }
}
