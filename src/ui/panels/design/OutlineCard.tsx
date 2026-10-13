/**
 * Outline tools for the selected surface: the six mask tools, add/subtract,
 * brush size & hardness, wand / smart-brush tolerance, whole-mask operations
 * (grow, shrink, feather, invert, select all, clear) and a coverage readout,
 * ending with the next step: give it a finish.
 */
import { useId, useState } from 'react';
import { BrickWall, Contrast, Expand, Feather, Minus, PaintRoller, Plus, Scan, Shrink, SquareDashed, type LucideIcon } from 'lucide-react';
import type { Design, Photo, Region } from '../../../../shared/types';
import { useStore } from '../../../state/store';
import { Button, Segmented, Slider, Spinner, cn } from '../../common';
import { activateCanvasTool, openFinishPanel } from './actions';
import { formatShare, formatSqFt } from './format';
import { useRegionStats } from './hooks';
import { OUTLINE_TOOLS, OutlineToolIcon, isOutlineTool, type OutlineTool } from './icons';
import { MASK_OPS, runMaskOp, type MaskOpDef, type MaskOpId } from './maskOps';
import { prefersMaterial, surfaceNoun } from './surfaceKinds';
import { TreatmentSwatch, treatmentLabel } from './TreatmentSwatch';
import { Callout, LogSlider, Switch } from './ui';

const OP_ICONS: Record<MaskOpId, LucideIcon> = {
  grow: Expand,
  shrink: Shrink,
  feather: Feather,
  invert: Contrast,
  fill: Scan,
  clear: SquareDashed,
};

const BRUSHES: ReadonlySet<OutlineTool> = new Set<OutlineTool>(['smart-brush', 'brush', 'eraser']);

export function OutlineCard({ region, photo, design }: { region: Region; photo: Photo; design: Design }) {
  const tool = useStore((s) => s.tool);
  const opts = useStore((s) => s.toolOptions);
  const setOpts = useStore((s) => s.setToolOptions);
  const stats = useRegionStats(region, photo);
  const [busy, setBusy] = useState<MaskOpId | null>(null);
  const modeLabelId = useId();
  const active = isOutlineTool(tool) ? tool : null;
  const meta = OUTLINE_TOOLS.find((t) => t.id === active);
  const treatment = design.treatments[region.id];

  const runOp = (op: MaskOpDef) => {
    setBusy(op.id);
    // Let the button show its busy state before the (synchronous) pixel work.
    setTimeout(() => {
      runMaskOp(op, region.maskId, photo.width, photo.height)
        .then((changed) => {
          if (changed && op.id === 'clear') useStore.getState().notify(`Cleared the outline of “${region.name}”. Undo brings it back.`, 'info');
        })
        .catch((err: unknown) => useStore.getState().notify(`Could not change the outline: ${(err as Error).message}`, 'error'))
        .finally(() => setBusy(null));
    }, 0);
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="toolbar" aria-label="Outline tools" className="grid grid-cols-6 gap-1 rounded-xl bg-surface-2 p-1">
        {OUTLINE_TOOLS.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              title={`${t.label} (${t.shortcut}) — ${t.hint}`}
              onClick={() => activateCanvasTool(t.id)}
              className={cn(
                'flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                on ? 'bg-surface text-accent shadow-sm' : 'text-muted hover:bg-surface/60 hover:text-text',
              )}
            >
              <OutlineToolIcon tool={t.id} />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {meta ? meta.hint : 'Pick a tool, then work on the photo. The smart brush is the quickest way to cover a wall, siding or lawn.'}
      </p>

      {active && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          {active !== 'eraser' && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted" id={modeLabelId}>
                Mode
              </span>
              <div role="group" aria-labelledby={modeLabelId}>
                <Segmented
                  size="sm"
                  value={opts.maskMode}
                  onChange={(maskMode) => setOpts({ maskMode })}
                  options={[
                    { value: 'add', label: <><Plus className="size-3.5" aria-hidden /> Add</>, title: 'Add to the outline' },
                    { value: 'erase', label: <><Minus className="size-3.5" aria-hidden /> Subtract</>, title: 'Remove from the outline (or hold Alt)' },
                  ]}
                />
              </div>
            </div>
          )}
          {BRUSHES.has(active) && (
            <>
              <LogSlider
                label="Brush size"
                value={opts.brushRadius}
                min={2}
                max={400}
                valueText={`${opts.brushRadius} px`}
                onChange={(v) => setOpts({ brushRadius: Math.round(v) })}
              />
              <Slider
                label="Edge hardness"
                value={Math.round(opts.brushHardness * 100)}
                min={0}
                max={100}
                format={(v) => (v >= 90 ? `${v}% · crisp` : v <= 30 ? `${v}% · soft` : `${v}%`)}
                onChange={(v) => setOpts({ brushHardness: v / 100 })}
              />
            </>
          )}
          {active === 'smart-brush' && (
            <div className="flex flex-col gap-1">
              <Slider label="Color match" value={opts.smartTolerance} min={2} max={60} onChange={(v) => setOpts({ smartTolerance: v })} />
              <p className="text-[11px] text-subtle">Lower keeps strictly to the color you start on; higher reaches into shadows and texture.</p>
            </div>
          )}
          {active === 'wand' && (
            <>
              <div className="flex flex-col gap-1">
                <Slider label="Tolerance" value={opts.wandTolerance} min={2} max={60} onChange={(v) => setOpts({ wandTolerance: v })} />
                <p className="text-[11px] text-subtle">How different a color can be and still be selected.</p>
              </div>
              <Switch checked={opts.wandContiguous} onChange={(v) => setOpts({ wandContiguous: v })} label="Connected areas only" />
            </>
          )}
          {(active === 'polygon' || active === 'lasso') && (
            <p className="text-[11px] text-subtle">
              {active === 'polygon' ? 'Enter or double-click finishes the shape · Backspace removes the last point · Esc cancels.' : 'Release to fill the shape you drew.'}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite">
        {!stats ? (
          <span className="inline-flex items-center gap-2 text-muted">
            <Spinner className="size-3.5" /> Loading outline…
          </span>
        ) : stats.empty ? (
          <span className="text-warning">Nothing outlined yet — tap or brush over the {surfaceNoun(region.surface)} in the photo.</span>
        ) : (
          <span className="text-muted">
            Covers <span className="font-medium text-text">{formatShare(stats.coverage)}</span> of the photo
            {stats.sqft !== null && <> · {formatSqFt(stats.sqft)}</>}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {MASK_OPS.map((op) => {
          const Icon = OP_ICONS[op.id];
          const disabled = !stats || (op.needsContent && stats.empty) || (busy !== null && busy !== op.id);
          return (
            <Button
              key={op.id}
              size="sm"
              variant="secondary"
              title={op.title}
              disabled={disabled}
              loading={busy === op.id}
              icon={<Icon className="size-3.5" aria-hidden />}
              onClick={() => runOp(op)}
              className={cn('min-w-0 px-2', op.id === 'clear' && 'hover:text-danger')}
            >
              <span className="truncate">{op.label}</span>
            </Button>
          );
        })}
      </div>

      {stats && !stats.empty && (
        treatment ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-surface-2 p-2.5">
            <TreatmentSwatch treatment={treatment} className="size-9" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="text-muted">Finish in {design.name}</p>
              <p className="truncate font-medium text-text">{treatmentLabel(treatment)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => openFinishPanel(region.id, treatment.type === 'material' ? 'materials' : 'paint')}>
              Change
            </Button>
          </div>
        ) : (
          <Callout
            tone="accent"
            title="Outline looks right? Give it a finish"
            action={
              <>
                <Button
                  size="sm"
                  variant={prefersMaterial(region.surface) ? 'secondary' : 'primary'}
                  icon={<PaintRoller className="size-4" />}
                  onClick={() => openFinishPanel(region.id, 'paint')}
                >
                  Paint color
                </Button>
                <Button
                  size="sm"
                  variant={prefersMaterial(region.surface) ? 'primary' : 'secondary'}
                  icon={<BrickWall className="size-4" />}
                  onClick={() => openFinishPanel(region.id, 'materials')}
                >
                  Material
                </Button>
              </>
            }
          >
            Step 3: choose a paint color or a material — it previews on the photo instantly.
          </Callout>
        )
      )}
    </div>
  );
}
