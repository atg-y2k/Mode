/**
 * The editor stage: mounts the StageController on two DPR-aware canvases and
 * renders the HTML chrome that floats over the photo (contextual HUD, zoom
 * controls, compare divider & labels, render status, calibration dialog).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { AlertTriangle, ChevronsLeftRight, Layers, Maximize, Minus, Plus, RefreshCw } from 'lucide-react';
import type { Photo } from '../../../shared/types';
import { activeDesignOf, useStore, type ViewState } from '../../state/store';
import { IconButton, Spinner, cn } from '../common';
import { CalibrationModal } from './CalibrationModal';
import { MenuButton } from './Menu';
import { StageController, type StageSnapshot } from './StageController';
import { StageHud } from './StageHud';
import { Kbd, Tooltip } from './Tooltip';
import { layoutPanes } from './viewTransform';

const EMPTY_SNAPSHOT: StageSnapshot = {
  width: 0,
  height: 0,
  scale: 1,
  fitted: true,
  layout: layoutPanes({ width: 0, height: 0 }, false),
  compareX: 0.5,
  designReady: false,
  rendering: false,
  renderError: null,
  polygonPoints: 0,
  busy: null,
  calibrationDraft: null,
};

const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY_SNAPSHOT;

const PILL = 'pointer-events-auto rounded-xl bg-black/65 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md';

export function Stage({ photo }: { photo: Photo }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [controller, setController] = useState<StageController | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const display = displayRef.current;
    const overlay = overlayRef.current;
    if (!host || !display || !overlay) return;
    let c: StageController;
    try {
      c = new StageController(host, display, overlay, photo.id);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
      return;
    }
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [photo.id]);

  const snap = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getSnapshot ?? emptySnapshot);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-stage">
      <div
        ref={hostRef}
        tabIndex={0}
        role="application"
        aria-roledescription="photo editor"
        aria-label={`${photo.name}. Use the tool palette or keyboard shortcuts. Arrow keys nudge the selection; Delete removes it.`}
        data-testid="editor-stage"
        className="absolute inset-0 touch-none select-none outline-none [-webkit-touch-callout:none] [-webkit-user-select:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        <canvas ref={displayRef} aria-hidden className="pointer-events-none absolute left-0 top-0" />
        <canvas ref={overlayRef} aria-hidden className="pointer-events-none absolute left-0 top-0" />
      </div>

      {initError && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">{initError}</div>
      )}

      {controller && (
        <>
          <CompareOverlay controller={controller} snap={snap} photo={photo} containerRef={containerRef} />
          <StageHud controller={controller} snap={snap} photo={photo} />
          <StatusPill controller={controller} snap={snap} />
          <ZoomControls controller={controller} snap={snap} />
          <CalibrationModal photo={photo} draft={snap.calibrationDraft} onClose={() => controller.clearCalibrationDraft()} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ZoomControls({ controller, snap }: { controller: StageController; snap: StageSnapshot }) {
  const masks = useStore((s) => s.view.masks);
  const pct = Math.round(snap.scale * 100);
  const setMasks = (m: ViewState['masks']) => useStore.getState().setView({ masks: m });
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 z-10 flex">
      <div className={cn(PILL, 'flex items-center gap-0.5 p-0.5')}>
        <Tooltip content={<span className="flex items-center">Zoom out<Kbd>Ctrl −</Kbd></span>} side="top">
          <IconButton label="Zoom out" tone="stage" onClick={() => controller.zoomOut()}>
            <Minus className="size-4" />
          </IconButton>
        </Tooltip>
        <Tooltip content={snap.fitted ? 'Show actual pixels (100%)' : 'Fit photo to screen'} side="top">
          <button
            type="button"
            onClick={() => (snap.fitted ? controller.actualSize() : controller.fit())}
            aria-label={`Zoom ${pct}%. ${snap.fitted ? 'Show actual size' : 'Fit to screen'}`}
            className="h-9 min-w-12 rounded-lg px-1 text-xs font-semibold tabular-nums text-white/90 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
          >
            {pct}%
          </button>
        </Tooltip>
        <Tooltip content={<span className="flex items-center">Zoom in<Kbd>Ctrl +</Kbd></span>} side="top">
          <IconButton label="Zoom in" tone="stage" onClick={() => controller.zoomIn()}>
            <Plus className="size-4" />
          </IconButton>
        </Tooltip>
        <Tooltip content={<span className="flex items-center">Fit to screen<Kbd>Ctrl 0</Kbd></span>} side="top">
          <IconButton label="Fit to screen" tone="stage" active={snap.fitted} onClick={() => controller.fit()}>
            <Maximize className="size-4" />
          </IconButton>
        </Tooltip>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20" />
        <MenuButton
          label="Surface highlights"
          tone="stage"
          align="end"
          items={[
            { label: 'Selected surface', checked: masks === 'selected', onSelect: () => setMasks('selected') },
            { label: 'All surfaces', checked: masks === 'all', onSelect: () => setMasks('all') },
            { label: 'Hide highlights', checked: masks === 'none', onSelect: () => setMasks('none') },
          ]}
        >
          <Layers className="size-4" />
        </MenuButton>
      </div>
    </div>
  );
}

function StatusPill({ controller, snap }: { controller: StageController; snap: StageSnapshot }) {
  const showOriginal = useStore((s) => s.view.showOriginal);
  let content = null;
  if (snap.busy) {
    content = (
      <>
        <Spinner className="text-white" />
        <span>{snap.busy}</span>
      </>
    );
  } else if (snap.renderError) {
    content = (
      <>
        <AlertTriangle className="size-4 text-warning" aria-hidden />
        <span className="max-w-56 truncate" title={snap.renderError}>
          Couldn’t render this design — showing the original
        </span>
        <button
          type="button"
          onClick={() => controller.retryRender()}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Retry
        </button>
      </>
    );
  } else if (showOriginal) {
    content = <span className="font-medium">Original photo</span>;
  } else if (snap.rendering) {
    content = (
      <>
        <Spinner className="text-white" />
        <span>{snap.designReady ? 'Updating…' : 'Rendering design…'}</span>
      </>
    );
  }
  if (!content) return null;
  return (
    <div className="pointer-events-none absolute bottom-14 left-2 z-10 max-w-[calc(100%-1rem)] sm:bottom-2 sm:max-w-[calc(100%-17rem)]">
      <div role="status" aria-live="polite" className={cn(PILL, 'flex h-10 items-center gap-2 px-3 text-xs')}>
        {content}
      </div>
    </div>
  );
}

function CompareOverlay({
  controller,
  snap,
  photo,
  containerRef,
}: {
  controller: StageController;
  snap: StageSnapshot;
  photo: Photo;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const compare = useStore((s) => s.view.compare);
  const showOriginal = useStore((s) => s.view.showOriginal);
  const designName = activeDesignOf(photo)?.name ?? 'Design';
  const dragging = useRef(false);
  const { layout } = snap;
  if (compare === 'off' || snap.width === 0) return null;

  const label = (text: string, left: number, top: number, align: 'left' | 'right' = 'left') => (
    <span
      className="pointer-events-none absolute z-[7] max-w-[40%] truncate rounded-lg bg-black/65 px-2.5 py-1 text-xs font-semibold text-white shadow ring-1 ring-white/10 backdrop-blur-md"
      style={align === 'left' ? { left, top } : { right: snap.width - left, top }}
    >
      {text}
    </span>
  );

  if (compare === 'split' && layout.original) {
    const o = layout.original;
    const d = layout.design;
    return (
      <>
        <div
          aria-hidden
          className="pointer-events-none absolute z-[6] bg-black/60"
          style={
            layout.orientation === 'horizontal'
              ? { left: o.x + o.width, top: 0, width: d.x - o.width, height: snap.height }
              : { top: o.y + o.height, left: 0, height: d.y - o.height, width: snap.width }
          }
        />
        {label('Original', o.x + 8, o.y + 8)}
        {label(showOriginal ? 'Original' : designName, d.x + 8, d.y + 8)}
      </>
    );
  }

  if (compare !== 'slider' || showOriginal) return null;
  const pane = layout.design;
  const x = pane.x + pane.width * snap.compareX;
  const pct = Math.round(snap.compareX * 100);

  const fromClientX = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || pane.width <= 0) return;
    controller.setCompareX((clientX - rect.left - pane.x) / pane.width);
  };

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute top-0 z-[6] h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: x }} />
      <div
        className="absolute top-0 z-[6] h-full w-8 -translate-x-1/2 cursor-ew-resize touch-none"
        style={{ left: x }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          fromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromClientX(e.clientX);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <button
          type="button"
          role="slider"
          aria-label="Before and after divider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}% original, ${100 - pct}% design`}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            let next: number | null = null;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = snap.compareX - step;
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = snap.compareX + step;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = 1;
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            controller.setCompareX(next);
          }}
          className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg ring-1 ring-black/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <ChevronsLeftRight className="size-5" aria-hidden />
        </button>
      </div>
      {snap.compareX > 0.12 && label('Original', pane.x + 8, pane.y + 8)}
      {snap.compareX < 0.88 && label(designName, pane.x + pane.width - 8, pane.y + 8, 'right')}
    </>
  );
}
