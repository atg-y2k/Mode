/**
 * Building blocks of the Materials panel: the material browser (suggested
 * for the surface or all, grouped by category, with texture swatches), the
 * current material card and its adjustments (pattern size, rotation, tint,
 * strength).
 */
import { memo, useId, useMemo, useState } from 'react';
import { Check, RotateCcw, Search, Trash } from 'lucide-react';
import { SURFACE_LABELS, type MaterialDef, type MaterialTreatment, type SurfaceKind } from '../../../../shared/types';
import { MATERIALS, materialsForSurface } from '../../../assets/catalog';
import { normalizeHex } from '../../../engine/color';
import { Button, Slider, TextInput, cn } from '../../common';
import { formatCostRange, formatDegrees, formatScale, formatUnitSize } from './format';
import {
  MATERIAL_CATEGORY_LABELS,
  groupMaterials,
  isDefaultAdjust,
  normalizeRotation,
  scaledUnitSize,
  searchMaterials,
  snapScale,
  unitNoun,
} from './materials';
import { displayHex } from './paint';
import { MaterialThumb } from './TreatmentSwatch';
import { Chip, GroupLabel, LogSlider, Switch } from './ui';

function safeList(fn: () => MaterialDef[]): MaterialDef[] {
  try {
    const list = fn();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

/** "Show all" survives tab switches within the session. */
let rememberShowAll = false;

export function MaterialTile({ material, selected, onPick }: { material: MaterialDef; selected: boolean; onPick: () => void }) {
  const cost = formatCostRange(material.cost);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={`${material.name} — ${material.description}`}
      className={cn(
        'group flex min-w-0 flex-col gap-1.5 rounded-xl p-1 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-2',
      )}
    >
      <span className={cn('relative block aspect-square w-full overflow-hidden rounded-lg', selected ? 'ring-2 ring-accent' : 'ring-1 ring-black/10')}>
        <MaterialThumb material={material} className="size-full border-0 transition-transform duration-300 group-hover:scale-105" rounded="rounded-none" />
        {selected && (
          <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-accent-fg shadow">
            <Check className="size-3" aria-hidden />
          </span>
        )}
      </span>
      <span className="line-clamp-2 px-0.5 text-xs font-medium leading-tight text-text">{material.name}</span>
      {cost && <span className="-mt-1 truncate px-0.5 text-[10px] text-subtle">{cost}</span>}
    </button>
  );
}

/** Memoized: pass stable callbacks so adjusting the current material doesn't re-render every tile. */
export const MaterialBrowser = memo(function MaterialBrowser({
  surface,
  currentId,
  onPick,
  onGoToPaint,
}: {
  surface: SurfaceKind;
  currentId: string | undefined;
  onPick: (m: MaterialDef) => void;
  onGoToPaint: () => void;
}) {
  const [showAll, setShowAllState] = useState(rememberShowAll);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const setShowAll = (v: boolean) => {
    rememberShowAll = v;
    setShowAllState(v);
  };

  const suggested = useMemo(() => safeList(() => materialsForSurface(surface)), [surface]);
  const all = useMemo(() => safeList(() => MATERIALS), []);
  const base = useMemo(() => {
    if (!showAll) return suggested;
    const seen = new Set(suggested.map((m) => m.id));
    return [...suggested, ...all.filter((m) => !seen.has(m.id))];
  }, [showAll, suggested, all]);
  const list = useMemo(() => searchMaterials(base, query), [base, query]);
  const groups = useMemo(() => groupMaterials(list), [list]);
  // The current material is always reachable, even when it is not suggested for this surface.
  const currentHidden = !!currentId && !showAll && !query && !suggested.some((m) => m.id === currentId);
  const noun = SURFACE_LABELS[surface].toLowerCase();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <label htmlFor={searchId} className="sr-only">
            Search materials
          </label>
          <TextInput id={searchId} type="search" value={query} placeholder="Search, e.g. “oak”, “slate”" onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <div className="shrink-0">
          <Switch checked={showAll} onChange={setShowAll} label={<span className="text-xs text-muted">Show all</span>} />
        </div>
      </div>

      {!showAll && suggested.length === 0 && !query && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line p-4">
          <p className="text-sm text-text">No materials are typical for {noun}.</p>
          <p className="text-xs text-muted">Paint usually suits it best — or browse every material anyway.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={onGoToPaint}>
              Choose a paint color
            </Button>
            <Button size="sm" onClick={() => setShowAll(true)}>
              Show all materials
            </Button>
          </div>
        </div>
      )}

      {list.length === 0 && (query || suggested.length > 0 || showAll) && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm text-text">{query.trim() ? `No materials match “${query.trim()}”.` : 'No materials available.'}</p>
          {(query || !showAll) && (
            <Button
              size="sm"
              variant="soft"
              onClick={() => {
                setQuery('');
                setShowAll(true);
              }}
            >
              Show all materials
            </Button>
          )}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.category} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{g.label}</h4>
            <span className="text-[10px] text-subtle">{g.materials.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {g.materials.map((m) => (
              <MaterialTile key={m.id} material={m} selected={m.id === currentId} onPick={() => onPick(m)} />
            ))}
          </div>
        </div>
      ))}

      {!showAll && !query && suggested.length > 0 && (
        <Button size="sm" variant="ghost" className="self-start text-muted" onClick={() => setShowAll(true)}>
          {currentHidden ? 'Show all materials (incl. the current one)' : all.length ? `Show all ${all.length} materials` : 'Show all materials'}
        </Button>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Current material
// ---------------------------------------------------------------------------

export function CurrentMaterialCard({ material, onRemove }: { material: MaterialDef | undefined; onRemove: () => void }) {
  if (!material) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line p-3">
        <p className="text-xs text-muted">This material is no longer in the catalog. Pick another one below.</p>
        <Button size="sm" variant="ghost" icon={<Trash className="size-3.5" />} onClick={onRemove}>
          Remove
        </Button>
      </div>
    );
  }
  const cost = formatCostRange(material.cost);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <MaterialThumb material={material} className="size-24 shadow-sm" rounded="rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-display text-lg leading-tight text-text">{material.name}</p>
          <p className="text-xs text-muted">
            {MATERIAL_CATEGORY_LABELS[material.category] ?? material.category}
            {cost && <> · {cost}</>}
          </p>
          <p className="line-clamp-3 text-xs leading-relaxed text-muted">{material.description}</p>
        </div>
      </div>
      <Button size="sm" variant="ghost" className="self-end hover:text-danger" icon={<Trash className="size-3.5" />} onClick={onRemove}>
        Remove material
      </Button>
    </div>
  );
}

const ROTATION_PRESETS = [0, 45, 90, -45] as const;

export function MaterialControls({
  material,
  treatment,
  tintChoices,
  onChange,
}: {
  material: MaterialDef | undefined;
  treatment: MaterialTreatment;
  /** Quick tint picks (e.g. paint colors used in the project). */
  tintChoices: { hex: string; name: string }[];
  onChange: (patch: Partial<MaterialTreatment>, coalesce?: string) => void;
}) {
  const tintId = useId();
  const unit = material ? scaledUnitSize(material, treatment.scale) : null;
  const noun = material ? unitNoun(material.texture.pattern) : null;
  const rotation = normalizeRotation(treatment.rotation);
  const tint = treatment.tint ? normalizeHex(treatment.tint) : null;
  const defaultTint = normalizeHex(material?.texture.colors[0] ?? '') ?? '#9a8a74';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Adjust</span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw className="size-3.5" />}
          disabled={isDefaultAdjust(treatment)}
          onClick={() => onChange({ scale: 1, rotation: 0, strength: 1, tint: undefined })}
          title="Back to true size, no rotation, no tint, full strength"
        >
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <LogSlider
          label="Pattern size"
          value={treatment.scale}
          min={0.25}
          max={4}
          valueText={treatment.scale === 1 ? '1× · true size' : formatScale(treatment.scale)}
          onChange={(v) => onChange({ scale: snapScale(v) }, 'scale')}
        />
        {unit && (
          <p className="text-[11px] text-subtle">
            {noun ? `Each ${noun} ≈ ${formatUnitSize(unit.w, unit.h)}` : `Pattern repeat ≈ ${formatUnitSize(unit.w, unit.h)}`}
            {treatment.scale !== 1 && (
              <>
                {' · '}
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange({ scale: 1 })}>
                  true size
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Slider label="Rotation" value={Math.max(-90, Math.min(90, rotation))} min={-90} max={90} format={formatDegrees} onChange={(v) => onChange({ rotation: v }, 'rotation')} />
        <div className="flex gap-1.5" role="group" aria-label="Rotation presets">
          {ROTATION_PRESETS.map((d) => (
            <Chip key={d} active={rotation === d} onClick={() => onChange({ rotation: d })} className="h-7 px-2.5">
              {formatDegrees(d)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={tintId}>
          Tint {tint && <span className="font-mono font-normal text-subtle">{displayHex(tint)}</span>}
        </GroupLabel>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={tintId}>
          <Chip active={!tint} onClick={() => onChange({ tint: undefined })} className="h-8 px-3">
            Natural
          </Chip>
          <label
            className={cn(
              'relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line shadow-inner',
              'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
              tint && !tintChoices.some((c) => normalizeHex(c.hex) === tint) && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
            )}
            style={{ background: tint ?? 'conic-gradient(#e46a5a, #e8c35a, #7bb26a, #5a9ad6, #9a72c9, #e46a5a)' }}
            title="Pick any tint color"
          >
            <span className="sr-only">Custom tint color</span>
            <input
              type="color"
              value={tint ?? defaultTint}
              onChange={(e) => onChange({ tint: e.target.value }, 'tint')}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
          {tintChoices.map((c) => {
            const hex = normalizeHex(c.hex);
            if (!hex) return null;
            const on = tint === hex;
            return (
              <button
                key={hex}
                type="button"
                aria-pressed={on}
                title={`Tint with ${c.name} (${displayHex(hex)})`}
                aria-label={`Tint with ${c.name}`}
                onClick={() => onChange({ tint: hex })}
                className={cn(
                  'size-8 shrink-0 rounded-full border border-black/10 shadow-inner transition-transform hover:scale-110',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  on && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                )}
                style={{ backgroundColor: hex }}
              />
            );
          })}
        </div>
        <p className="text-[11px] text-subtle">Recolors the material while keeping its grain and joints — e.g. stain a floor or match siding to a paint.</p>
      </div>

      <Slider
        label="Strength"
        value={Math.round(treatment.strength * 100)}
        min={0}
        max={100}
        format={(v) => `${v}%`}
        onChange={(v) => onChange({ strength: v / 100 }, 'strength')}
      />
    </div>
  );
}
