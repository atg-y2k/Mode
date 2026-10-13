/**
 * The surfaces of the active photo. Each row: color dot, name (double-click
 * or F2 to rename), surface type, estimated area (or a calibrate link),
 * what is applied in the current design option, and a hide toggle. The
 * selected row expands with type, rename, reorder and delete controls.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Trash } from 'lucide-react';
import { SURFACE_KINDS, SURFACE_LABELS, type Design, type Photo, type Region, type SurfaceKind } from '../../../../shared/types';
import { useStore } from '../../../state/store';
import { ConfirmModal, IconButton, Select, Spinner, cn } from '../../common';
import { activateCanvasTool, openFinishPanel, selectRegion } from './actions';
import { AREA_METHOD_LABELS, formatSqFt } from './format';
import { useRegionStats } from './hooks';
import { prefersMaterial, renameForSurfaceChange } from './surfaceKinds';
import { TreatmentSwatch, treatmentLabel } from './TreatmentSwatch';
import { RegionDot } from './ui';

const FIRST_EXTERIOR = SURFACE_KINDS.indexOf('siding');
const INSIDE_KINDS = SURFACE_KINDS.slice(0, FIRST_EXTERIOR).filter((k) => k !== 'other');
const OUTSIDE_KINDS = SURFACE_KINDS.slice(FIRST_EXTERIOR).filter((k) => k !== 'other');

/** Native select of every surface type, grouped Inside / Outside. */
export function SurfaceTypeSelect({ value, onChange, className, id }: { value: SurfaceKind; onChange: (v: SurfaceKind) => void; className?: string; id?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as SurfaceKind)} aria-label="Surface type" className={className}>
      <optgroup label="Inside">
        {INSIDE_KINDS.map((k) => (
          <option key={k} value={k}>
            {SURFACE_LABELS[k]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Outside">
        {OUTSIDE_KINDS.map((k) => (
          <option key={k} value={k}>
            {SURFACE_LABELS[k]}
          </option>
        ))}
      </optgroup>
      <option value="other">{SURFACE_LABELS.other}</option>
    </Select>
  );
}

export function RegionList({ photo, design, selectedId }: { photo: Photo; design: Design; selectedId: string | null }) {
  return (
    <ul className="-mx-1.5 flex flex-col gap-1" aria-label="Surfaces in this photo">
      {photo.regions.map((r, i) => (
        <RegionRow
          key={r.id}
          region={r}
          photo={photo}
          design={design}
          selected={r.id === selectedId}
          index={i}
          count={photo.regions.length}
        />
      ))}
    </ul>
  );
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

function RegionRow({
  region,
  photo,
  design,
  selected,
  index,
  count,
}: {
  region: Region;
  photo: Photo;
  design: Design;
  selected: boolean;
  index: number;
  count: number;
}) {
  const treatment = design.treatments[region.id];
  const hidden = design.hiddenRegionIds.includes(region.id);
  const stats = useRegionStats(region, photo);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  // Keep the selected row visible when it is picked on the photo.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const finishPanel: 'paint' | 'materials' =
    treatment?.type === 'material' ? 'materials' : treatment?.type === 'paint' ? 'paint' : prefersMaterial(region.surface) ? 'materials' : 'paint';

  const changeSurface = (next: SurfaceKind) => {
    if (next === region.surface) return;
    const taken = photo.regions.filter((r) => r.id !== region.id).map((r) => r.name);
    useStore.getState().updateRegion(region.id, { surface: next, name: renameForSurfaceChange(region.name, region.surface, next, taken) }, {});
  };

  let meta: ReactNode;
  if (!stats) meta = <Spinner className="size-3" />;
  else if (stats.empty) meta = <span className="text-warning">Not outlined yet</span>;
  else if (stats.sqft !== null) meta = <span title={`Area ${AREA_METHOD_LABELS[stats.method]}`}>{formatSqFt(stats.sqft)}</span>;
  else
    meta = (
      <span>
        Area unknown ·{' '}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            activateCanvasTool('calibrate');
          }}
          className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          title="Draw a line of known length on the photo to measure areas"
        >
          calibrate
        </button>
      </span>
    );

  return (
    <li ref={rowRef}>
      <div
        onClick={() => selectRegion(region.id)}
        className={cn(
          'rounded-xl transition-colors',
          selected ? 'bg-accent-soft/60 ring-1 ring-accent/40' : 'cursor-pointer hover:bg-surface-2',
        )}
      >
        <div className="flex min-h-12 items-center gap-2 py-1.5 pl-2.5 pr-1">
          <RegionDot color={region.color} />
          <div className="min-w-0 flex-1">
            {renaming ? (
              <RenameInput
                value={region.name}
                onDone={(name) => {
                  setRenaming(false);
                  if (name !== null && name !== region.name) useStore.getState().updateRegion(region.id, { name }, {});
                }}
              />
            ) : (
              <button
                type="button"
                aria-pressed={selected}
                onClick={(e) => {
                  stop(e);
                  selectRegion(region.id);
                }}
                onDoubleClick={(e) => {
                  stop(e);
                  setRenaming(true);
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'F2') {
                    e.preventDefault();
                    setRenaming(true);
                  }
                }}
                title="Select · double-click to rename"
                className="block w-full truncate rounded text-left text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {region.name}
              </button>
            )}
            <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
              <span className="truncate">{SURFACE_LABELS[region.surface]}</span>
              <span aria-hidden>·</span>
              {meta}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              openFinishPanel(region.id, finishPanel);
            }}
            title={treatment ? `${treatmentLabel(treatment)}${hidden ? ' (hidden)' : ''} — change` : 'Untouched — choose a paint or material'}
            aria-label={treatment ? `Finish: ${treatmentLabel(treatment)}. Change` : `${region.name} is untouched. Choose a paint or material`}
            className="flex shrink-0 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {treatment ? (
              <TreatmentSwatch treatment={treatment} hidden={hidden} className="size-8" />
            ) : (
              <span className="inline-flex h-7 items-center rounded-full border border-dashed border-line-strong px-2 text-[11px] font-medium text-subtle hover:border-accent hover:text-accent">
                Untouched
              </span>
            )}
          </button>
          <IconButton
            label={!treatment ? 'Nothing applied yet' : hidden ? `Show finish on ${region.name}` : `Hide finish on ${region.name}`}
            active={hidden}
            disabled={!treatment}
            onClick={(e) => {
              stop(e);
              useStore.getState().toggleRegionHidden(region.id);
            }}
          >
            {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
        </div>

        {selected && (
          <div className="flex items-center gap-1 border-t border-accent/15 px-1.5 py-1.5" onClick={stop}>
            <SurfaceTypeSelect value={region.surface} onChange={changeSurface} className="min-w-0 flex-1" />
            <IconButton label="Rename" onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Move up — painted earlier" disabled={index === 0} onClick={() => useStore.getState().moveRegion(region.id, -1)}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton label="Move down — painted later, on top" disabled={index === count - 1} onClick={() => useStore.getState().moveRegion(region.id, 1)}>
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton label={`Delete ${region.name}`} className="hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash className="size-4" />
            </IconButton>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${region.name}”?`}
        message={
          <>
            Its outline and whatever is applied to it in every design option will be removed. You can undo this with{' '}
            <kbd className="rounded border border-line bg-surface-2 px-1 font-sans text-xs">Ctrl/⌘ Z</kbd>.
          </>
        }
        confirmLabel="Delete surface"
        onConfirm={() => {
          const s = useStore.getState();
          s.deleteRegion(region.id);
          s.notify(`Deleted “${region.name}”.`, 'info');
        }}
      />
    </li>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    onDone(commit && name ? name.slice(0, 80) : null);
  };
  return (
    <input
      ref={ref}
      value={draft}
      aria-label="Surface name"
      maxLength={80}
      onClick={stop}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      }}
      className="h-7 w-full rounded-md border border-accent bg-surface px-1.5 text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
    />
  );
}
