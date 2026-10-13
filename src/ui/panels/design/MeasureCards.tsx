/**
 * Perspective plane, photo scale (calibration) and area cards for the
 * selected surface. Shared by the Surfaces and Materials panels.
 */
import { useId } from 'react';
import { Check, Grid3x3, Ruler, Trash } from 'lucide-react';
import type { Photo, Region } from '../../../../shared/types';
import { pxPerFoot } from '../../../assetList/area';
import { useStore } from '../../../state/store';
import { Badge, Button, cn } from '../../common';
import { activateCanvasTool } from './actions';
import { AREA_METHOD_LABELS, formatFeet, formatSqFt } from './format';
import type { RegionStats } from './hooks';
import { isHorizontalSurface, surfaceNoun } from './surfaceKinds';
import { Callout, PositiveNumberInput } from './ui';

/** Limit for typed real-world sizes (ft). */
const MAX_FT = 1000;

/**
 * Perspective plane: set / edit (tool 'plane'), real width and depth, remove.
 * `prompt` renders the "set a plane" state as an emphasized callout (Materials panel).
 */
export function PerspectiveCard({ region, prompt }: { region: Region; prompt?: boolean }) {
  const tool = useStore((s) => s.tool);
  const editing = tool === 'plane';
  const horizontal = isHorizontalSurface(region.surface);
  const plane = region.plane;
  const widthId = useId();
  const depthId = useId();

  if (!plane) {
    const text = horizontal
      ? `Floors, patios, lawns and decks recede into the distance. Drag four corners onto the ${surfaceNoun(region.surface)} so patterns shrink with perspective instead of lying flat.`
      : `Useful when the ${surfaceNoun(region.surface)} is seen at an angle: patterns then follow its perspective.`;
    if (prompt) {
      return (
        <Callout
          tone={horizontal ? 'accent' : 'info'}
          icon={<Grid3x3 className="size-4" />}
          title={horizontal ? 'Make it recede realistically' : undefined}
          action={
            <Button size="sm" variant={horizontal ? 'primary' : 'secondary'} icon={<Grid3x3 className="size-4" />} onClick={() => activateCanvasTool('plane')}>
              Set perspective plane
            </Button>
          }
        >
          {text}
        </Callout>
      );
    }
    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs leading-relaxed text-muted">
          {horizontal && (
            <span className="mr-1.5 align-middle">
              <Badge tone="accent">Recommended</Badge>
            </span>
          )}
          {text}
        </p>
        <Button className="self-start" size="sm" icon={<Grid3x3 className="size-4" />} onClick={() => activateCanvasTool('plane')}>
          Set perspective plane
        </Button>
      </div>
    );
  }

  const setSize = (patch: { widthFt?: number; heightFt?: number }) => {
    const next = { ...plane, ...patch };
    if (next.widthFt === undefined) delete next.widthFt;
    if (next.heightFt === undefined) delete next.heightFt;
    useStore.getState().updateRegion(region.id, { plane: next }, { coalesce: `panel:plane-size:${region.id}` });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success">
          <Check className="size-3" aria-hidden /> Plane set
        </Badge>
        <span className="text-xs text-muted">{editing ? 'Drag the corners on the photo.' : 'Textures follow its perspective.'}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => useStore.getState().setTool('select')}>
            Done editing
          </Button>
        ) : (
          <Button size="sm" icon={<Grid3x3 className="size-4" />} onClick={() => activateCanvasTool('plane')}>
            Edit corners
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash className="size-4" />}
          className="hover:text-danger"
          onClick={() => {
            const s = useStore.getState();
            s.updateRegion(region.id, { plane: undefined }, {});
            if (s.tool === 'plane') s.setTool('select');
          }}
        >
          Remove
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Real size of the plane (optional)</span>
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor={widthId} className="flex flex-col gap-1 text-[11px] text-subtle">
            Width
            <PositiveNumberInput id={widthId} value={plane.widthFt} suffix="ft" placeholder="auto" max={MAX_FT} onValueChange={(v) => setSize({ widthFt: v })} />
          </label>
          <label htmlFor={depthId} className="flex flex-col gap-1 text-[11px] text-subtle">
            {horizontal ? 'Depth' : 'Height'}
            <PositiveNumberInput id={depthId} value={plane.heightFt} suffix="ft" placeholder="auto" max={MAX_FT} onValueChange={(v) => setSize({ heightFt: v })} />
          </label>
        </div>
        <span className="text-[11px] text-subtle">Known sizes make patterns and areas true to scale; leave empty to estimate.</span>
      </div>
    </div>
  );
}

/** Photo scale: calibration status with calibrate / remove. */
export function CalibrationCard({ photo }: { photo: Photo }) {
  const cal = photo.calibration;
  const ppf = pxPerFoot(cal);
  if (!cal || !ppf) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="text-xs leading-relaxed text-muted">
          <span className="font-medium text-text">Not calibrated.</span> Draw along something you know the length of — a door (usually 80 in tall),
          a fence panel or a row of tiles — so areas and pattern sizes are true to scale.
        </p>
        <Button className="self-start" size="sm" icon={<Ruler className="size-4" />} onClick={() => activateCanvasTool('calibrate')}>
          Calibrate photo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs leading-relaxed text-muted">
        <span className="font-medium text-text">Scale set</span> from a {formatFeet(cal.lengthFt)} line · {Math.round(ppf)} px per foot.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Ruler className="size-4" />} onClick={() => activateCanvasTool('calibrate')}>
          Recalibrate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash className="size-4" />}
          className="hover:text-danger"
          onClick={() => {
            const s = useStore.getState();
            s.setCalibration(photo.id, undefined);
            s.notify('Calibration removed — sizes fall back to estimates.', 'info');
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

/** Estimated area of the surface with a manual override. */
export function AreaCard({ region, stats }: { region: Region; stats: RegionStats | null }) {
  const id = useId();
  const override = region.areaSqFtOverride;
  const estimate = stats && stats.method !== 'override' ? stats.sqft : null;
  let line: string;
  if (!stats) line = 'Measuring…';
  else if (stats.empty && override === undefined) line = 'Outline the surface to estimate its area.';
  else if (stats.sqft === null) line = 'Unknown — calibrate the photo or set a perspective plane with its real size.';
  else line = `${formatSqFt(stats.sqft)}, ${AREA_METHOD_LABELS[stats.method]}.`;
  return (
    <div className="flex flex-col gap-2">
      <p className={cn('text-xs', stats?.sqft !== null && stats ? 'text-text' : 'text-muted')}>{line}</p>
      <label htmlFor={id} className="flex flex-col gap-1 text-xs font-medium text-muted">
        Area override
        <PositiveNumberInput
          id={id}
          suffix="sq ft"
          value={override}
          placeholder={estimate !== null && estimate > 0 ? `${Math.round(estimate)} (estimate)` : 'Enter a measured area'}
          onValueChange={(v) => useStore.getState().updateRegion(region.id, { areaSqFtOverride: v }, { coalesce: `panel:area:${region.id}` })}
        />
        <span className="text-[11px] font-normal text-subtle">Measured it yourself? Enter it here; leave empty to use the estimate.</span>
      </label>
    </div>
  );
}
