/**
 * Fine-tune › Lighting: time of day, exposure, white balance, ambient strength,
 * contrast and saturation for the active design option; the placed lights
 * (on/off, select, delete); and fixtures / generic glows to place. The
 * selected light's inspector sits at the top.
 */
import { memo, useMemo, useRef, useState } from 'react';
import { CloudMoon, Lightbulb, Moon, Power, PowerOff, RotateCcw, Sun, Sunset, Trash2, type LucideIcon } from 'lucide-react';
import {
  DEFAULT_LIGHTING,
  TIMES_OF_DAY,
  type AssetDef,
  type Design,
  type LightingSettings,
  type PlacedLight,
  type SpaceKind,
  type TimeOfDay,
} from '../../../shared/types';
import { FIXTURES, parseZone } from '../../assets/catalog';
import {
  selectActiveDesign,
  selectActivePhoto,
  selectActiveSpace,
  selectSelectedLight,
  useStore,
} from '../../state/store';
import { Button, cn, EmptyState, IconButton, PanelHeader, Section, Segmented, Slider } from '../common';
import { AssetCard } from './scene/AssetCard';
import { AssetInfoModal } from './scene/AssetInfoModal';
import { Callout, KelvinChip, KelvinSlider, LightDot } from './scene/controls';
import { defaultSettingFor, fixturesFor, type SettingScope } from './scene/filters';
import {
  BEAM_LABELS,
  TIME_OF_DAY_HINTS,
  TIME_OF_DAY_LABELS,
  formatEv,
  formatKelvin,
  formatPercent,
  formatSigned100,
  whiteBalanceName,
} from './scene/format';
import { useStableCallback } from './scene/hooks';
import { BEAM_ICONS, LightInspector } from './scene/LightInspector';
import { GENERIC_GLOWS, kelvinCss, type GenericGlow } from './scene/lights';
import { PlacementBanner } from './scene/PlacementBanner';
import { armFixture, armGlow, isArmed, setAllLightsOn } from './scene/placement';

const TIME_ICONS: Record<TimeOfDay, LucideIcon> = { day: Sun, golden: Sunset, dusk: CloudMoon, night: Moon };

/** Remembers the fixture scope across tab switches (per space kind). */
let rememberedScope: { kind: SpaceKind | undefined; value: SettingScope } | null = null;

function isDefaultLighting(l: LightingSettings): boolean {
  return (Object.keys(DEFAULT_LIGHTING) as (keyof LightingSettings)[]).every((k) => l[k] === DEFAULT_LIGHTING[k]);
}

export function LightingPanel() {
  const photo = useStore(selectActivePhoto);
  const design = useStore(selectActiveDesign);
  const kind = useStore((s) => selectActiveSpace(s)?.kind);
  const selectedLight = useStore(selectSelectedLight);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!photo || !design) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <PanelHeader title="Lighting" subtitle="Time of day, color and light fixtures" />
        <EmptyState icon={<Lightbulb className="size-6" />} title="No photo open">
          Open a photo of this space to preview it at golden hour, dusk or night and to place lights.
        </EmptyState>
      </div>
    );
  }

  const revealInspector = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelHeader title="Lighting" subtitle={`${design.name} · time of day, color and fixtures`} />
      <div ref={scrollRef} className="scroll-thin @container min-h-0 flex-1 overflow-y-auto">
        <PlacementBanner only="light" />
        {selectedLight && (
          <Section title="Selected light">
            <LightInspector light={selectedLight} photo={photo} design={design} />
          </Section>
        )}
        <SceneSection design={design} />
        <PlacedLightsSection lights={design.lights} selectedId={selectedLight?.id ?? null} onSelect={revealInspector} />
        <AddLightsSection kind={kind} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene look
// ---------------------------------------------------------------------------

function TimeOfDayPicker({ value, onChange }: { value: TimeOfDay; onChange: (t: TimeOfDay) => void }) {
  return (
    <div role="radiogroup" aria-label="Time of day" className="grid grid-cols-4 gap-0.5 rounded-xl bg-surface-2 p-0.5">
      {TIMES_OF_DAY.map((t) => {
        const Icon = TIME_ICONS[t];
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            title={TIME_OF_DAY_HINTS[t]}
            onClick={() => onChange(t)}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1 rounded-[10px] text-xs font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              active ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
            )}
          >
            <Icon className={cn('size-4', active && 'text-gold')} aria-hidden />
            {TIME_OF_DAY_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

function SceneSection({ design }: { design: Design }) {
  const l = design.lighting;
  const update = (patch: Partial<LightingSettings>, key?: string) =>
    useStore.getState().updateLighting(patch, key ? { coalesce: `panel:lighting:${key}` } : {});
  const showDuskTip = design.lights.some((x) => x.on) && l.timeOfDay === 'day';

  return (
    <Section
      title="Scene"
      action={
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw className="size-3.5" />}
          disabled={isDefaultLighting(l)}
          onClick={() => update({ ...DEFAULT_LIGHTING })}
          title="Back to the photo as taken"
        >
          Reset
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5">
        <TimeOfDayPicker value={l.timeOfDay} onChange={(t) => update({ timeOfDay: t })} />
        <p className="text-xs text-subtle">{TIME_OF_DAY_HINTS[l.timeOfDay]}</p>
      </div>

      {showDuskTip && (
        <Callout
          tone="accent"
          icon={<Lightbulb className="size-4" />}
          action={
            <Button size="sm" variant="soft" icon={<CloudMoon className="size-4" />} onClick={() => update({ timeOfDay: 'dusk' })}>
              Preview at dusk
            </Button>
          }
        >
          Placed lights barely show in daylight — they come alive at dusk and night.
        </Callout>
      )}

      <Slider
        label="Exposure"
        value={Math.round(l.exposure * 10) / 10}
        min={-3}
        max={3}
        step={0.1}
        format={formatEv}
        onChange={(v) => update({ exposure: v }, 'exposure')}
      />
      <KelvinSlider
        label="Warmth"
        value={l.kelvin}
        min={2000}
        max={9000}
        step={100}
        valueText={`${formatKelvin(l.kelvin)} · ${whiteBalanceName(l.kelvin)}`}
        ends={['Warmer', 'Cooler']}
        onChange={(k) => update({ kelvin: k }, 'kelvin')}
      />
      <div className="flex flex-col gap-1">
        <Slider
          label="Ambient strength"
          value={Math.round(l.ambient * 100)}
          min={0}
          max={100}
          step={1}
          format={(v) => formatPercent(v / 100)}
          onChange={(v) => update({ ambient: v / 100 }, 'ambient')}
        />
        <p className="text-xs text-subtle">
          {l.timeOfDay === 'day' ? 'How strongly golden hour, dusk or night change the photo.' : `How strongly the ${TIME_OF_DAY_LABELS[l.timeOfDay].toLowerCase()} look is applied.`}
        </p>
      </div>
      <Slider
        label="Contrast"
        value={Math.round(l.contrast * 100)}
        min={-100}
        max={100}
        step={1}
        format={(v) => formatSigned100(v / 100)}
        onChange={(v) => update({ contrast: v / 100 }, 'contrast')}
      />
      <Slider
        label="Saturation"
        value={Math.round(l.saturation * 100)}
        min={-100}
        max={100}
        step={1}
        format={(v) => formatSigned100(v / 100)}
        onChange={(v) => update({ saturation: v / 100 }, 'saturation')}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Placed lights
// ---------------------------------------------------------------------------

function PlacedLightsSection({ lights, selectedId, onSelect }: { lights: PlacedLight[]; selectedId: string | null; onSelect: () => void }) {
  const anyOn = lights.some((l) => l.on);
  return (
    <Section
      title={lights.length ? `Placed lights · ${lights.length}` : 'Placed lights'}
      action={
        lights.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={anyOn ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
            onClick={() => setAllLightsOn(!anyOn)}
          >
            {anyOn ? 'All off' : 'All on'}
          </Button>
        ) : undefined
      }
    >
      {lights.length === 0 ? (
        <p className="text-sm text-muted">No lights yet. Pick a fixture or a glow below, then tap the photo where the light sits.</p>
      ) : (
        <ul className="-mx-2 flex flex-col gap-0.5">
          {lights.map((l) => (
            <LightRow key={l.id} light={l} selected={l.id === selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function LightRow({ light, selected, onSelect }: { light: PlacedLight; selected: boolean; onSelect: () => void }) {
  const s = useStore.getState;
  return (
    <li className={cn('flex items-center gap-1 rounded-lg pr-1 transition-colors', selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => {
          s().select({ lightId: selected ? null : light.id, objectId: null, regionId: null });
          if (!selected) onSelect();
        }}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-2 text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <LightDot kelvin={light.kelvin} on={light.on} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', light.on ? 'text-text' : 'text-muted')}>{light.name}</span>
          <span className="block text-[11px] text-subtle">
            {BEAM_LABELS[light.beam]}
            {!light.on && ' · off'}
          </span>
        </span>
        <KelvinChip kelvin={light.kelvin} dim={!light.on} />
      </button>
      <IconButton
        size="sm"
        label={light.on ? `Turn off ${light.name}` : `Turn on ${light.name}`}
        active={light.on}
        onClick={() => s().updateLight(light.id, { on: !light.on }, {})}
        className="pointer-coarse:size-9"
      >
        {light.on ? <Power className="size-4" /> : <PowerOff className="size-4" />}
      </IconButton>
      <IconButton size="sm" label={`Delete ${light.name}`} onClick={() => s().deleteLight(light.id)} className="pointer-coarse:size-9">
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Fixtures & glows
// ---------------------------------------------------------------------------

function GlowButton({ glow, armed }: { glow: GenericGlow; armed: boolean }) {
  const Icon = BEAM_ICONS[glow.beam];
  return (
    <button
      type="button"
      aria-pressed={armed}
      title={glow.hint}
      onClick={() => armGlow(glow)}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        armed ? 'border-accent bg-accent-soft ring-2 ring-accent/30' : 'border-line bg-surface hover:bg-surface-2',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stage">
        <Icon className="size-4" style={{ color: kelvinCss(glow.kelvin), filter: `drop-shadow(0 0 4px ${kelvinCss(glow.kelvin)})` }} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text">{glow.name}</span>
        <span className="block truncate text-[11px] text-muted">{armed ? 'Placing…' : glow.short}</span>
      </span>
    </button>
  );
}

/** Memoized: only the library, the armed placement and the space kind re-render the fixture grid. */
const AddLightsSection = memo(function AddLightsSection({ kind }: { kind: SpaceKind | undefined }) {
  const library = useStore((s) => s.library);
  const placement = useStore((s) => s.placement);
  const zoneLabel = useStore((s) => s.project?.location.hardinessZone ?? s.project?.location.climate?.hardinessZone);
  const canPlace = useStore((s) => !!selectActiveDesign(s));
  const [scope, setScopeState] = useState<{ kind: SpaceKind | undefined; value: SettingScope } | null>(rememberedScope);
  const setting: SettingScope = scope && scope.kind === kind ? scope.value : defaultSettingFor(kind);
  const setSetting = (value: SettingScope) => {
    const next = { kind, value };
    rememberedScope = next;
    setScopeState(next);
  };
  const [info, setInfo] = useState<AssetDef | null>(null);
  const closeInfo = useStableCallback(() => setInfo(null));
  const placeFromInfo = useStableCallback((a: AssetDef) => {
    setInfo(null);
    armFixture(a);
  });

  const fixtures = useMemo(() => fixturesFor(FIXTURES, library, setting), [library, setting]);

  return (
    <Section title="Add lights">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Glow only — no fixture drawn</span>
        <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
          {GENERIC_GLOWS.map((g) => (
            <GlowButton key={g.id} glow={g} armed={isArmed(placement, g)} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs font-medium text-muted">Fixtures</span>
        <Segmented
          size="sm"
          value={setting}
          onChange={setSetting}
          options={[
            { value: 'indoor', label: 'Indoor' },
            { value: 'outdoor', label: 'Outdoor' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {fixtures.length === 0 ? (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
          No {setting === 'all' ? '' : `${setting} `}fixtures to show.{' '}
          {setting !== 'all' && (
            <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => setSetting('all')}>
              Show all fixtures
            </button>
          )}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3 @3xl:grid-cols-4">
          {fixtures.map((a) => (
            <AssetCard key={a.id} asset={a} zone={undefined} armed={isArmed(placement, a)} onPick={() => armFixture(a)} onInfo={() => setInfo(a)} />
          ))}
        </div>
      )}
      <p className="text-xs text-subtle">Tap a fixture, then tap the photo where it hangs or stands. Its glow follows the time of day.</p>

      <AssetInfoModal
        asset={info}
        onClose={closeInfo}
        zone={parseZone(zoneLabel)}
        zoneLabel={zoneLabel}
        canPlace={canPlace}
        onPlace={placeFromInfo}
      />
    </Section>
  );
});
