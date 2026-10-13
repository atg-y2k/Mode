/**
 * Inspector for the selected placed light: name, on/off, beam, reach,
 * brightness, color temperature (with presets), aim & spread for spots,
 * fixture art and size, duplicate and delete. Shown at the top of the
 * Lighting panel.
 */
import { useId, useMemo } from 'react';
import {
  Copy,
  Lightbulb,
  LampCeiling,
  LampWallUp,
  RectangleHorizontal,
  Spline,
  Spotlight,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { LIGHT_BEAMS, type Design, type LightBeam, type Photo, type PlacedLight } from '../../../../shared/types';
import { findAsset } from '../../../assets/catalog';
import { pxPerFoot } from '../../../assetList/area';
import { useStore } from '../../../state/store';
import { Button, cn, IconButton, Slider, TextInput, Toggle } from '../../common';
import { AssetThumb } from './AssetThumb';
import { KelvinSlider, LightDot, LogSlider } from './controls';
import {
  BEAM_HINTS,
  BEAM_LABELS,
  KELVIN_PRESETS,
  formatDegrees,
  formatFeetShort,
  formatKelvin,
  formatPercent,
  formatSize,
  hasVisual,
  lampColorName,
} from './format';
import { beamChangePatch, duplicateLightData, isLineBeam, kelvinCss } from './lights';

export const BEAM_ICONS: Record<LightBeam, LucideIcon> = {
  omni: Lightbulb,
  down: LampCeiling,
  up: LampWallUp,
  spot: Spotlight,
  strip: RectangleHorizontal,
  string: Spline,
};

function aimName(deg: number): string {
  const a = ((Math.round(deg) % 360) + 540) % 360 - 180; // -180..180
  if (Math.abs(a - 90) <= 30) return 'down';
  if (Math.abs(a + 90) <= 30) return 'up';
  if (Math.abs(a) <= 30) return 'right';
  if (Math.abs(Math.abs(a) - 180) <= 30) return 'left';
  return a > 0 ? (a < 90 ? 'down-right' : 'down-left') : a > -90 ? 'up-right' : 'up-left';
}

export function LightInspector({ light, photo, design }: { light: PlacedLight; photo: Photo; design: Design }) {
  const library = useStore((s) => s.library);
  const asset = useMemo(() => (light.assetId ? findAsset(light.assetId, library) : undefined), [light.assetId, library]);
  const ppf = pxPerFoot(photo.calibration);
  const key = `panel:light:${light.id}`;
  const beamLabelId = useId();
  const update = (patch: Partial<Omit<PlacedLight, 'id'>>, coalesce?: string) =>
    useStore.getState().updateLight(light.id, patch, coalesce ? { coalesce: `${key}:${coalesce}` } : {});

  const longEdge = Math.max(photo.width, photo.height);
  const maxRadius = Math.max(longEdge * 1.5, light.radius * 1.2);
  const maxFixture = Math.max(photo.height * 0.8, light.fixtureSize * 1.2);
  const line = isLineBeam(light.beam);
  const canShowFixture = hasVisual(asset);
  const index = design.lights.findIndex((l) => l.id === light.id);

  const duplicate = () => {
    const off = Math.max(12, Math.round(photo.width * 0.03));
    useStore.getState().addLight(duplicateLightData(light, off));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {asset ? (
          <AssetThumb asset={asset} className="size-14 shrink-0 border border-line" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-line bg-stage">
            <LightDot kelvin={light.kelvin} on={light.on} className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <TextInput
            aria-label="Light name"
            value={light.name}
            maxLength={60}
            onChange={(e) => update({ name: e.target.value }, 'name')}
            onBlur={(e) => {
              if (!e.target.value.trim()) update({ name: asset?.name ?? BEAM_LABELS[light.beam] });
            }}
          />
          <p className="mt-1 truncate text-xs text-muted">
            {asset ? asset.name : 'Glow without a fixture'}
            {design.lights.length > 1 && ` · ${index + 1} of ${design.lights.length}`}
          </p>
        </div>
        <IconButton label="Done — deselect" onClick={() => useStore.getState().select({ lightId: null })}>
          <X className="size-4" />
        </IconButton>
      </div>

      <Toggle label={light.on ? 'Light is on' : 'Light is off'} checked={light.on} onChange={(v) => update({ on: v })} />

      <div className="flex flex-col gap-2">
        <span id={beamLabelId} className="text-xs font-medium text-muted">
          Light spread
        </span>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby={beamLabelId}>
          {LIGHT_BEAMS.map((b) => {
            const Icon = BEAM_ICONS[b];
            const active = light.beam === b;
            return (
              <button
                key={b}
                type="button"
                aria-pressed={active}
                title={BEAM_HINTS[b]}
                onClick={() => !active && update(beamChangePatch(light, b))}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[11px] font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                  active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {BEAM_LABELS[b]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-subtle">
          {BEAM_HINTS[light.beam]}
          {line && ' — drag its two ends on the photo.'}
        </p>
      </div>

      <LogSlider
        label={line ? 'Glow width' : 'Reach'}
        value={light.radius}
        min={8}
        max={maxRadius}
        valueText={ppf ? `about ${formatFeetShort(light.radius / ppf)}` : formatSize(light.radius, null)}
        onChange={(r) => update({ radius: r }, 'radius')}
      />

      <Slider
        label="Brightness"
        value={Math.round(light.intensity * 100)}
        min={0}
        max={200}
        step={5}
        format={(v) => formatPercent(v / 100)}
        onChange={(v) => update({ intensity: v / 100 }, 'intensity')}
      />

      <div className="flex flex-col gap-2">
        <KelvinSlider
          label="Color"
          value={light.kelvin}
          min={1800}
          max={6500}
          step={50}
          valueText={`${formatKelvin(light.kelvin)} · ${lampColorName(light.kelvin)}`}
          ends={['Candle', 'Daylight']}
          onChange={(k) => update({ kelvin: k }, 'kelvin')}
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color presets">
          {KELVIN_PRESETS.map((p) => {
            const active = Math.abs(light.kelvin - p.kelvin) < 25;
            return (
              <button
                key={p.kelvin}
                type="button"
                aria-pressed={active}
                onClick={() => update({ kelvin: p.kelvin })}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors pointer-coarse:h-9',
                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                  active ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-surface text-muted hover:text-text',
                )}
              >
                <span aria-hidden className="size-3 rounded-full ring-1 ring-black/15" style={{ backgroundColor: kelvinCss(p.kelvin) }} />
                <span className="tabular-nums">{p.kelvin}</span>
                <span className="sr-only">K, {p.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {light.beam === 'spot' && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
          <Slider
            label="Aim"
            value={Math.round(light.angle ?? 90)}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${formatDegrees(v)} · ${aimName(v)}`}
            onChange={(v) => update({ angle: v }, 'angle')}
          />
          <Slider
            label="Beam width"
            value={Math.round(light.spread ?? 40)}
            min={5}
            max={150}
            step={1}
            format={formatDegrees}
            onChange={(v) => update({ spread: v }, 'spread')}
          />
        </div>
      )}

      {canShowFixture && (
        <div className="flex flex-col gap-3">
          <Toggle label="Show the fixture" checked={light.showFixture} onChange={(v) => update({ showFixture: v })} />
          {light.showFixture && (
            <LogSlider
              label="Fixture size"
              value={light.fixtureSize}
              min={6}
              max={maxFixture}
              valueText={`${formatSize(light.fixtureSize, ppf)} tall`}
              onChange={(v) => update({ fixtureSize: v }, 'fixture')}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Copy className="size-4" />} onClick={duplicate}>
          Duplicate
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => useStore.getState().deleteLight(light.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
