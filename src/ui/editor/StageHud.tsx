/**
 * Contextual heads-up bar floating at the top of the stage: which surface is
 * being edited, add/subtract, brush size / tolerance, polygon actions,
 * eyedropper result, calibration status, placement status. Gives touch users
 * everything that keyboard users get from modifiers and shortcuts.
 */
import type { ReactNode } from 'react';
import { Check, Minus, Plus, Trash, Undo2, X } from 'lucide-react';
import type { Photo, Region } from '../../../shared/types';
import { maskBounds } from '../../engine/mask';
import * as runtime from '../../state/runtime';
import { resolveAsset, selectSelectedRegion, useStore, type ToolId } from '../../state/store';
import { cn } from '../common';
import { formatFeet, dist, isLineBeam, quadFromRect } from './geometry';
import type { StageController, StageSnapshot } from './StageController';
import { BRUSH_TOOLS, MASK_TOOLS, TOOL_META, ToolIcon, promptForRegion } from './tools';

const HUD_BTN_BASE =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors pointer-coarse:h-9 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40';
/** Quiet button on the dark HUD. */
const HUD_BTN = `${HUD_BTN_BASE} text-white/90 hover:bg-white/15`;
/** Emphasized (primary) button on the dark HUD. */
const HUD_BTN_PRIMARY = `${HUD_BTN_BASE} bg-white text-black hover:bg-white/85`;

function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
}

/** Bring a side panel into view (switches the mobile pane on phones). */
export function showPanel(panel: 'surfaces' | 'paint' | 'library'): void {
  const s = useStore.getState();
  s.setPanel(panel);
  if (isNarrow()) s.setView({ mobilePane: 'panel' });
}

const HELP: Partial<Record<ToolId, string>> = {
  'smart-brush': 'Start on the color you want · Alt subtracts · [ ] size',
  brush: 'Alt subtracts · [ ] size',
  eraser: 'Alt adds back · [ ] size',
  wand: 'Tap a color · Shift-tap replaces · Alt subtracts',
  lasso: 'Drag around the area · Alt subtracts',
};

export function StageHud({ controller, snap, photo }: { controller: StageController; snap: StageSnapshot; photo: Photo }) {
  const tool = useStore((s) => s.tool);
  const compare = useStore((s) => s.view.compare);
  const showOriginal = useStore((s) => s.view.showOriginal);
  if (showOriginal) return null;

  let content: ReactNode = null;
  if (MASK_TOOLS.has(tool)) content = <MaskHud tool={tool} controller={controller} snap={snap} />;
  else if (tool === 'plane') content = <PlaneHud photo={photo} />;
  else if (tool === 'eyedropper') content = <EyedropperHud />;
  else if (tool === 'calibrate') content = <CalibrateHud photo={photo} />;
  else if (tool === 'place') content = <PlaceHud />;
  if (!content) return null;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 flex justify-center px-2',
        compare !== 'off' ? 'top-12' : 'top-2',
      )}
    >
      <div
        role="toolbar"
        aria-label={`${TOOL_META[tool].label} options`}
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-2xl bg-black/70 px-2 py-1.5 text-xs text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      >
        {content}
      </div>
    </div>
  );
}

function HudLabel({ tool }: { tool: ToolId }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 pl-1 pr-0.5 font-semibold">
      <ToolIcon tool={tool} className="size-4" />
      <span className="hidden sm:inline">{TOOL_META[tool].label}</span>
    </span>
  );
}

function Help({ children }: { children: ReactNode }) {
  return <span className="hidden px-1 text-white/70 lg:inline">{children}</span>;
}

function Divider() {
  return <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-white/20 sm:block" />;
}

function RegionChip() {
  const region = useStore(selectSelectedRegion);
  if (!region) {
    return (
      <button
        type="button"
        className={HUD_BTN_PRIMARY}
        onClick={() => {
          promptForRegion();
          showPanel('surfaces');
        }}
      >
        Choose a surface
      </button>
    );
  }
  return (
    <span className="inline-flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-lg bg-white/10 px-2 pointer-coarse:h-9" title={`Editing ${region.name}`}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-1 ring-white/50" style={{ backgroundColor: region.color }} />
      <span className="truncate">{region.name}</span>
    </span>
  );
}

function ModeToggle() {
  const mode = useStore((s) => s.toolOptions.maskMode);
  const set = (maskMode: 'add' | 'erase') => useStore.getState().setToolOptions({ maskMode });
  return (
    <div role="radiogroup" aria-label="Mask mode" className="inline-flex shrink-0 rounded-lg bg-white/10 p-0.5">
      {(
        [
          { v: 'add', label: 'Add', icon: Plus },
          { v: 'erase', label: 'Subtract', icon: Minus },
        ] as const
      ).map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={mode === o.v}
          onClick={() => set(o.v)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors pointer-coarse:h-8',
            'focus-visible:outline-2 focus-visible:outline-white',
            mode === o.v ? 'bg-white text-black' : 'text-white/85 hover:bg-white/10',
          )}
        >
          <o.icon className="size-3.5" aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range input with a logarithmic mapping (fine control at small sizes). */
function LogRange({
  label,
  value,
  min,
  max,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const toT = (v: number) => Math.round((Math.log(v / min) / Math.log(max / min)) * 1000);
  const fromT = (t: number) => Math.round(min * Math.pow(max / min, t / 1000));
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 px-1">
      <span className="text-white/75">{label}</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={10}
        value={toT(Math.max(min, Math.min(max, value)))}
        onChange={(e) => onChange(fromT(Number(e.target.value)))}
        aria-valuetext={display}
        className="w-20 sm:w-24"
      />
      <span className="w-8 tabular-nums text-white/90">{display}</span>
    </label>
  );
}

function LinearRange({
  label,
  value,
  min,
  max,
  onChange,
  title,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  title: string;
}) {
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 px-1" title={title}>
      <span className="text-white/75">{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-20 sm:w-24" />
      <span className="w-6 tabular-nums text-white/90">{value}</span>
    </label>
  );
}

function MaskHud({ tool, controller, snap }: { tool: ToolId; controller: StageController; snap: StageSnapshot }) {
  const opts = useStore((s) => s.toolOptions);
  const set = useStore((s) => s.setToolOptions);
  return (
    <>
      <HudLabel tool={tool} />
      <RegionChip />
      {tool !== 'eraser' && <ModeToggle />}
      {BRUSH_TOOLS.has(tool) && (
        <LogRange
          label="Size"
          value={opts.brushRadius}
          min={2}
          max={400}
          display={`${opts.brushRadius}`}
          onChange={(v) => set({ brushRadius: v })}
        />
      )}
      {tool === 'smart-brush' && (
        <LinearRange
          label="Match"
          title="How different a color can be and still get painted"
          value={opts.smartTolerance}
          min={2}
          max={60}
          onChange={(v) => set({ smartTolerance: v })}
        />
      )}
      {tool === 'wand' && (
        <>
          <LinearRange
            label="Tolerance"
            title="How different a color can be and still be selected"
            value={opts.wandTolerance}
            min={2}
            max={60}
            onChange={(v) => set({ wandTolerance: v })}
          />
          <button
            type="button"
            aria-pressed={opts.wandContiguous}
            title={opts.wandContiguous ? 'Only connected areas are selected' : 'Similar colors anywhere in the photo are selected'}
            onClick={() => set({ wandContiguous: !opts.wandContiguous })}
            className={cn(HUD_BTN, opts.wandContiguous && 'bg-white/15')}
          >
            {opts.wandContiguous ? 'Connected only' : 'Whole photo'}
          </button>
        </>
      )}
      {tool === 'polygon' && <PolygonActions controller={controller} points={snap.polygonPoints} />}
      {HELP[tool] && (
        <>
          <Divider />
          <Help>{HELP[tool]}</Help>
        </>
      )}
    </>
  );
}

function PolygonActions({ controller, points }: { controller: StageController; points: number }) {
  if (!points) return <Help>Click each corner · finish on the first point, Enter or double-click</Help>;
  return (
    <>
      <span className="px-1 tabular-nums text-white/75">
        {points} point{points === 1 ? '' : 's'}
      </span>
      <button type="button" className={HUD_BTN} onClick={() => controller.undoPolygonPoint()} aria-label="Remove last point (Backspace)">
        <Undo2 className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Undo point</span>
      </button>
      <button
        type="button"
        className={HUD_BTN_PRIMARY}
        disabled={points < 3}
        onClick={() => controller.closePolygon()}
        title={points < 3 ? 'Add at least three points' : 'Fill the shape (Enter)'}
      >
        <Check className="size-3.5" aria-hidden />
        Finish
      </button>
      <button type="button" className={HUD_BTN} onClick={() => controller.cancelPolygon()} aria-label="Cancel shape (Esc)">
        <X className="size-3.5" aria-hidden />
      </button>
    </>
  );
}

function resetPlane(region: Region, photo: Photo) {
  const mask = runtime.getMask(region.maskId);
  const b = mask ? maskBounds(mask) : null;
  const rect =
    b && b.w >= 12 && b.h >= 12 ? b : { x: photo.width * 0.25, y: photo.height * 0.4, w: photo.width * 0.5, h: photo.height * 0.4 };
  useStore.getState().updateRegion(region.id, { plane: { ...region.plane, quad: quadFromRect(rect) } }, {});
}

function PlaneHud({ photo }: { photo: Photo }) {
  const region = useStore(selectSelectedRegion);
  return (
    <>
      <HudLabel tool="plane" />
      <RegionChip />
      {region?.plane && (
        <>
          <Help>Drag the 4 corners onto the surface’s real corners — the grid shows how textures will recede</Help>
          <button type="button" className={HUD_BTN} onClick={() => resetPlane(region, photo)} title="Fit the plane to the surface outline again">
            Reset
          </button>
          <button
            type="button"
            className={HUD_BTN}
            onClick={() => {
              useStore.getState().updateRegion(region.id, { plane: undefined }, {});
              useStore.getState().setTool('select');
            }}
            title="Remove the perspective plane (textures lie flat)"
          >
            <Trash className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </>
      )}
      <button type="button" className={HUD_BTN_PRIMARY} onClick={() => useStore.getState().setTool('select')}>
        <Check className="size-3.5" aria-hidden />
        Done
      </button>
    </>
  );
}

function EyedropperHud() {
  const picked = useStore((s) => s.pickedColor);
  return (
    <>
      <HudLabel tool="eyedropper" />
      {picked ? (
        <>
          <span className="inline-flex items-center gap-1.5 px-1">
            <span aria-hidden className="size-5 rounded-md ring-1 ring-white/60" style={{ backgroundColor: picked }} />
            <span className="font-mono tabular-nums">{picked.toUpperCase()}</span>
          </span>
          <button type="button" className={HUD_BTN_PRIMARY} onClick={() => showPanel('paint')}>
            Use in Paint
          </button>
        </>
      ) : (
        <span className="px-1 text-white/80">Tap the photo to sample an original color</span>
      )}
    </>
  );
}

function CalibrateHud({ photo }: { photo: Photo }) {
  const cal = photo.calibration;
  return (
    <>
      <HudLabel tool="calibrate" />
      {cal ? (
        <>
          <span className="px-1 text-white/85">
            Scale set: {formatFeet(cal.lengthFt)} ≈ {Math.round(dist(cal.a, cal.b))} px
            <span className="hidden sm:inline"> · draw again to replace</span>
          </span>
          <button
            type="button"
            className={HUD_BTN}
            onClick={() => {
              const s = useStore.getState();
              s.setCalibration(photo.id, undefined);
              s.notify('Calibration removed — sizes fall back to estimates.', 'info');
            }}
          >
            <Trash className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </>
      ) : (
        <span className="px-1 text-white/80">
          Drag along something you know the length of<span className="hidden sm:inline"> — a door, a fence panel, a tile</span>
        </span>
      )}
    </>
  );
}

function PlaceHud() {
  const placement = useStore((s) => s.placement);
  if (!placement) return null;
  const name = placement.kind === 'object' ? (resolveAsset(placement.assetId)?.name ?? 'item') : placement.name;
  const line = placement.kind === 'light' && isLineBeam(placement.beam);
  return (
    <>
      <HudLabel tool="place" />
      <span className="min-w-0 truncate px-1">
        <span className="text-white/75">Placing </span>
        <span className="font-semibold">{name}</span>
      </span>
      <Help>{line ? 'Drag to draw it · Shift keeps placing' : 'Tap where its base touches the ground · Shift keeps placing'}</Help>
      <button type="button" className={HUD_BTN} onClick={() => useStore.getState().setPlacement(null)} aria-label="Stop placing (Esc)">
        <X className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Cancel</span>
      </button>
    </>
  );
}
