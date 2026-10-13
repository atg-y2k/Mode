/**
 * Building blocks of the Paint panel: the current color chip with LRV,
 * finish / coats / strength, the fan-deck browser (collections, families,
 * search, dense swatch grid), color tiles (similar, used in this project,
 * eyedropper matches), the custom color form and the picked-color card.
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Check, Pipette, Search, Trash, X } from 'lucide-react';
import { COLOR_FAMILIES, PAINT_FINISHES, type ColorFamily, type PaintColor, type PaintFinish, type PaintTreatment } from '../../../../shared/types';
import { PAINT_COLORS, getPaint, searchPaints } from '../../../assets/catalog';
import { lrv, normalizeHex, textColorOn } from '../../../engine/color';
import { Button, IconButton, Segmented, Slider, TextInput, cn } from '../../common';
import {
  FAMILY_LABELS,
  FAMILY_SWATCH,
  FINISH_HINTS,
  FINISH_LABELS,
  FINISH_SHORT,
  displayHex,
  filterPaints,
  groupByCollection,
  lrvHint,
  lrvLabel,
  paintCollections,
  paintDisplayName,
  paintFamilies,
  type CustomColor,
  type PaintFilter,
} from './paint';
import { Chip, GroupLabel } from './ui';

// ---------------------------------------------------------------------------
// Current color
// ---------------------------------------------------------------------------

export function LrvMeter({ hex }: { hex: string }) {
  const value = lrv(hex);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-muted" title="Light Reflectance Value: 0 = absorbs all light, 100 = reflects all light">
          Light reflectance (LRV)
        </span>
        <span className="tabular-nums text-text">
          {value} · {lrvLabel(value)}
        </span>
      </div>
      <div
        className="relative h-2 rounded-full ring-1 ring-inset ring-black/10"
        style={{ background: 'linear-gradient(90deg, #121212, #f7f7f7)' }}
        role="meter"
        aria-label="Light reflectance value"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}, ${lrvLabel(value).toLowerCase()}`}
      >
        <span
          aria-hidden
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30"
          style={{ left: `${Math.min(97, Math.max(3, value))}%`, backgroundColor: hex }}
        />
      </div>
      <p className="text-[11px] text-subtle">{lrvHint(value)}</p>
    </div>
  );
}

/** The paint on the surface, shown like a large paint chip. */
export function CurrentPaintCard({ paint, onRemove }: { paint: PaintTreatment; onRemove: () => void }) {
  const fg = textColorOn(paint.hex);
  const catalog = paint.paintId ? getPaint(paint.paintId) : undefined;
  const source = [paint.brand, paint.code].filter(Boolean).join(' · ') || (catalog ? `${catalog.collection} · Mode palette` : 'Custom color');
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-line shadow-sm">
        <div className="flex h-28 flex-col justify-end px-4 pb-3" style={{ backgroundColor: paint.hex, color: fg }}>
          <p className="font-display text-xl leading-tight">{paintDisplayName(paint)}</p>
          <p className="font-mono text-xs tabular-nums opacity-80">{displayHex(paint.hex)}</p>
        </div>
        <div className="flex items-center gap-2 bg-surface py-1.5 pl-4 pr-1.5">
          <p className="min-w-0 flex-1 truncate text-xs text-muted" title={source}>
            {source}
          </p>
          <Button size="sm" variant="ghost" icon={<Trash className="size-3.5" />} className="hover:text-danger" onClick={onRemove}>
            Remove paint
          </Button>
        </div>
      </div>
      <LrvMeter hex={paint.hex} />
    </div>
  );
}

/** Finish (segmented), coats and strength of the current paint. */
export function PaintSettings({ paint, onChange }: { paint: PaintTreatment; onChange: (patch: Partial<PaintTreatment>, coalesce?: string) => void }) {
  const finishId = useId();
  const coatsId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <GroupLabel id={finishId}>Finish</GroupLabel>
        <div role="group" aria-labelledby={finishId}>
          <Segmented<PaintFinish>
            size="sm"
            className="w-full"
            value={paint.finish}
            onChange={(finish) => onChange({ finish })}
            options={PAINT_FINISHES.map((f) => ({ value: f, label: FINISH_SHORT[f], title: `${FINISH_LABELS[f]} — ${FINISH_HINTS[f]}` }))}
          />
        </div>
        <p className="text-[11px] text-subtle">
          <span className="font-medium text-muted">{FINISH_LABELS[paint.finish]}:</span> {FINISH_HINTS[paint.finish]}
        </p>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <GroupLabel id={coatsId}>Coats</GroupLabel>
          <div role="group" aria-labelledby={coatsId}>
            <Segmented<'1' | '2' | '3'>
              size="sm"
              value={String(Math.min(3, Math.max(1, Math.round(paint.coats || 2)))) as '1' | '2' | '3'}
              onChange={(v) => onChange({ coats: Number(v) })}
              options={[
                { value: '1', label: '1', title: 'One coat — refresh of a similar color' },
                { value: '2', label: '2', title: 'Two coats — the standard for a color change' },
                { value: '3', label: '3', title: 'Three coats — big jumps, e.g. dark to light' },
              ]}
            />
          </div>
        </div>
        <Slider
          label="Strength"
          value={Math.round(paint.strength * 100)}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => onChange({ strength: v / 100 }, 'strength')}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color tiles (similar, used, matches)
// ---------------------------------------------------------------------------

export interface ColorTileItem {
  key: string;
  hex: string;
  name: string;
  caption?: string;
  selected?: boolean;
}

export function ColorTiles({ items, onPick, label }: { items: ColorTileItem[]; onPick: (key: string) => void; label: string }) {
  return (
    <ul className="grid grid-cols-4 gap-2" aria-label={label}>
      {items.map((it) => (
        <li key={it.key} className="min-w-0">
          <button
            type="button"
            onClick={() => onPick(it.key)}
            aria-pressed={!!it.selected}
            title={`${it.name} · ${displayHex(it.hex)}${it.caption ? ` · ${it.caption}` : ''}`}
            className="group flex w-full min-w-0 flex-col gap-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span
              className={cn(
                'relative block h-11 w-full rounded-lg ring-inset transition-transform group-hover:scale-[1.04]',
                it.selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-black/10',
              )}
              style={{ backgroundColor: it.hex }}
            >
              {it.selected && <Check className="absolute inset-0 m-auto size-4" style={{ color: textColorOn(it.hex) }} aria-hidden />}
            </span>
            <span className="truncate text-[11px] font-medium leading-tight text-text">{it.name}</span>
            {it.caption && <span className="-mt-0.5 truncate text-[10px] leading-tight text-subtle">{it.caption}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Fan deck
// ---------------------------------------------------------------------------

/** Filters survive switching tabs (module memory, per session). */
let rememberedFilter: PaintFilter = { collection: null, family: null, query: '' };

function safeCatalog(): PaintColor[] {
  return Array.isArray(PAINT_COLORS) ? PAINT_COLORS : [];
}

/** Arrow-key navigation across every swatch in the deck (roving focus). */
function onDeckKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const current = (e.target as HTMLElement).closest<HTMLElement>('[data-swatch]');
  if (!current) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-swatch]')];
  const i = items.indexOf(current);
  if (i < 0) return;
  let target: HTMLElement | undefined;
  if (e.key === 'ArrowLeft') target = items[i - 1];
  else if (e.key === 'ArrowRight') target = items[i + 1];
  else if (e.key === 'Home') target = items[0];
  else if (e.key === 'End') target = items[items.length - 1];
  else {
    const r = current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const down = e.key === 'ArrowDown';
    const pool = down ? items.slice(i + 1).filter((el) => el.getBoundingClientRect().top > r.top + r.height / 2) : items.slice(0, i).filter((el) => el.getBoundingClientRect().top < r.top - r.height / 2);
    if (pool.length) {
      const rowTop = down ? Math.min(...pool.map((el) => el.getBoundingClientRect().top)) : Math.max(...pool.map((el) => el.getBoundingClientRect().top));
      const row = pool.filter((el) => Math.abs(el.getBoundingClientRect().top - rowTop) < 2);
      target = row.reduce((best, el) => {
        const d = Math.abs(el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - cx);
        const bd = Math.abs(best.getBoundingClientRect().left + best.getBoundingClientRect().width / 2 - cx);
        return d < bd ? el : best;
      }, row[0]);
    }
  }
  if (target) {
    e.preventDefault();
    target.focus();
  }
}

export function FanDeck({
  current,
  onPick,
  onEyedropper,
  eyedropperActive,
}: {
  current: PaintTreatment | undefined;
  onPick: (paint: PaintColor) => void;
  onEyedropper: () => void;
  eyedropperActive: boolean;
}) {
  const [filter, setFilterState] = useState<PaintFilter>(rememberedFilter);
  const [peek, setPeek] = useState<PaintColor | null>(null);
  const searchId = useId();
  const setFilter = (patch: Partial<PaintFilter>) => {
    setFilterState((f) => {
      const next = { ...f, ...patch };
      rememberedFilter = next;
      return next;
    });
  };

  const catalog = safeCatalog();
  const collections = useMemo(() => paintCollections(catalog), [catalog]);
  const families = useMemo(() => paintFamilies(catalog, COLOR_FAMILIES), [catalog]);
  const list = useMemo(() => {
    try {
      return filterPaints(catalog, filter, searchPaints);
    } catch {
      return filterPaints(catalog, filter);
    }
  }, [catalog, filter]);
  const grouped = !filter.collection && !filter.family && !filter.query.trim();
  const groups = useMemo(() => (grouped ? groupByCollection(list) : [{ collection: '', paints: list }]), [grouped, list]);
  const selectedId = current?.paintId;
  const firstFocusable = list.some((p) => p.id === selectedId) ? selectedId : list[0]?.id;
  const filtered = !grouped;
  const peekText = peek
    ? `${peek.name} · ${displayHex(peek.hex)} · ${peek.collection}`
    : current
      ? `On this surface: ${paintDisplayName(current)} · ${displayHex(current.hex)}`
      : 'Hover or tap a chip to see its name';

  if (catalog.length === 0) {
    return <p className="text-xs text-muted">The color library isn’t available right now — use a custom color below.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <label htmlFor={searchId} className="sr-only">
            Search colors
          </label>
          <TextInput
            id={searchId}
            type="search"
            value={filter.query}
            placeholder="Search colors"
            onChange={(e) => setFilter({ query: e.target.value })}
            className="pl-8"
          />
        </div>
        <Button
          variant={eyedropperActive ? 'soft' : 'secondary'}
          icon={<Pipette className="size-4" />}
          onClick={onEyedropper}
          title="Sample a color from the original photo"
          aria-pressed={eyedropperActive}
        >
          <span className="hidden min-[400px]:inline">From photo</span>
          <span className="sr-only min-[400px]:hidden">Pick a color from the photo</span>
        </Button>
      </div>

      <div className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Collections">
        <Chip active={!filter.collection} onClick={() => setFilter({ collection: null })}>
          All colors
        </Chip>
        {collections.map((c) => (
          <Chip key={c.name} active={filter.collection === c.name} onClick={() => setFilter({ collection: filter.collection === c.name ? null : c.name })} title={`${c.count} colors`}>
            {c.name}
          </Chip>
        ))}
      </div>

      <div className="scroll-thin -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label="Color family">
        <button
          type="button"
          aria-pressed={!filter.family}
          onClick={() => setFilter({ family: null })}
          className={cn(
            'inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
            !filter.family ? 'bg-text text-surface' : 'bg-surface-2 text-muted hover:text-text',
          )}
        >
          Any hue
        </button>
        {families.map((f: ColorFamily) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter.family === f}
            aria-label={`Hue: ${FAMILY_LABELS[f]}`}
            title={FAMILY_LABELS[f]}
            onClick={() => setFilter({ family: filter.family === f ? null : f })}
            className={cn(
              'size-7 shrink-0 rounded-full ring-1 ring-inset ring-black/15 transition-transform hover:scale-110',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              filter.family === f && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
            )}
            style={{ backgroundColor: FAMILY_SWATCH[f] }}
          />
        ))}
      </div>

      <p className="min-h-4 truncate text-xs text-muted" aria-live="polite">
        {peekText}
      </p>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm text-text">No colors match{filter.query.trim() ? ` “${filter.query.trim()}”` : ' these filters'}.</p>
          <Button size="sm" variant="soft" onClick={() => setFilter({ collection: null, family: null, query: '' })}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3" onKeyDown={onDeckKeyDown} onPointerLeave={() => setPeek(null)}>
          {filtered && (
            <p className="-mt-1 text-[11px] text-subtle">
              {list.length} color{list.length === 1 ? '' : 's'}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.collection || 'all'} className="flex flex-col gap-1.5">
              {grouped && (
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{g.collection}</h4>
                  <span className="text-[10px] text-subtle">{g.paints.length}</span>
                </div>
              )}
              <div role="group" aria-label={g.collection || 'Colors'} className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
                {g.paints.map((p) => {
                  const selected = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-swatch
                      tabIndex={p.id === firstFocusable ? 0 : -1}
                      aria-pressed={selected}
                      aria-label={`${p.name}, ${displayHex(p.hex)}`}
                      title={`${p.name} · ${displayHex(p.hex)}`}
                      onClick={() => onPick(p)}
                      onPointerEnter={() => setPeek(p)}
                      onFocus={() => setPeek(p)}
                      onBlur={() => setPeek(null)}
                      className={cn(
                        'relative aspect-square rounded-md transition-transform hover:z-10 hover:scale-110 focus-visible:z-10',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        selected ? 'z-10 ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-inset ring-black/10',
                      )}
                      style={{ backgroundColor: p.hex }}
                    >
                      {selected && <Check className="absolute inset-0 m-auto size-4" style={{ color: textColorOn(p.hex) }} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom color
// ---------------------------------------------------------------------------

export function CustomColorForm({
  initial,
  onApply,
}: {
  initial: CustomColor | undefined;
  /** `live` while dragging the native color picker (coalesced into one undo step). */
  onApply: (color: CustomColor, live: boolean) => void;
}) {
  const [hex, setHex] = useState(() => normalizeHex(initial?.hex ?? '') ?? '#c8bca8');
  const [name, setName] = useState(initial?.name ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const ids = { hex: useId(), name: useId(), brand: useId(), code: useId(), picker: useId() };
  const valid = normalizeHex(hex);

  const apply = () => {
    if (!valid) {
      setError('Enter a hex color like #C8BCA8.');
      return;
    }
    setError(null);
    setHex(valid);
    onApply({ hex: valid, name, brand, code }, false);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <p className="text-xs text-muted">Have a color from a paint store fan deck? Enter its hex (from the brand’s website), name and code.</p>
      <div className="flex items-end gap-2">
        <label htmlFor={ids.picker} className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line shadow-inner" style={{ backgroundColor: valid ?? 'transparent' }}>
          <span className="sr-only">Open color picker</span>
          <input
            id={ids.picker}
            type="color"
            value={valid ?? '#000000'}
            onChange={(e) => {
              const v = e.target.value;
              setHex(v);
              setError(null);
              onApply({ hex: v, name, brand, code }, true);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <label htmlFor={ids.hex} className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Hex
          <TextInput
            id={ids.hex}
            value={hex}
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            aria-invalid={!valid || undefined}
            onChange={(e) => {
              setHex(e.target.value);
              setError(null);
            }}
            className={cn('font-mono uppercase', !valid && hex.trim() !== '' && 'border-danger')}
          />
        </label>
      </div>
      <label htmlFor={ids.name} className="flex flex-col gap-1 text-xs font-medium text-muted">
        Color name
        <TextInput id={ids.name} value={name} maxLength={60} placeholder="e.g. Soft linen" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={ids.brand} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
          Brand
          <TextInput id={ids.brand} value={brand} maxLength={40} placeholder="optional" onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label htmlFor={ids.code} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
          Code
          <TextInput id={ids.code} value={code} maxLength={24} placeholder="optional" onChange={(e) => setCode(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="self-start" disabled={hex.trim() === ''}>
        Apply custom color
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Eyedropper result
// ---------------------------------------------------------------------------

export function PickedColorCard({
  hex,
  matches,
  canApply,
  onUse,
  onPickMatch,
  onPickAgain,
  onDismiss,
}: {
  hex: string;
  matches: ColorTileItem[];
  canApply: boolean;
  onUse: () => void;
  onPickMatch: (key: string) => void;
  onPickAgain: () => void;
  onDismiss: () => void;
}) {
  const value = lrv(hex);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="size-12 shrink-0 rounded-xl border border-black/10 shadow-inner" style={{ backgroundColor: hex }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">Picked from the photo</p>
          <p className="font-mono text-xs tabular-nums text-muted">
            {displayHex(hex)} · LRV {value}
          </p>
        </div>
        <IconButton label="Dismiss picked color" size="sm" onClick={onDismiss}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!canApply} onClick={onUse}>
          Use {displayHex(hex)}
        </Button>
        <Button size="sm" variant="ghost" icon={<Pipette className="size-3.5" />} onClick={onPickAgain}>
          Pick again
        </Button>
      </div>
      {matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted">Closest colors in the library</p>
          <ColorTiles items={matches} onPick={onPickMatch} label="Closest library colors" />
        </div>
      )}
      {!canApply && <p className="text-xs text-muted">Choose a surface below to apply it.</p>}
    </div>
  );
}
