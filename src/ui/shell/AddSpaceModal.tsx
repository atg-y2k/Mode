/**
 * "Add a space": SpaceType tiles grouped Inside / Outside, optional name;
 * "Add & choose photos" opens the photo picker right away. Also exports the
 * tile grid (reused by "Change type") and the space-type picker modal.
 */
import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { EXTERIOR_SPACE_TYPES, INTERIOR_SPACE_TYPES, SPACE_TYPE_LABELS, spaceKindOf, type SpaceType } from '../../../shared/types';
import { useStore } from '../../state/store';
import { Button, Field, Modal, TextInput, cn } from '../common';
import { isDesktopViewport } from './hooks';
import { pickPhotos } from './photoImport';
import { closeAddSpace, useShellUI } from './shellUI';
import { SPACE_HINTS, SPACE_ICONS } from './spaceMeta';

const GROUPS = {
  interior: { title: 'Inside', types: INTERIOR_SPACE_TYPES as readonly SpaceType[] },
  exterior: { title: 'Outside', types: EXTERIOR_SPACE_TYPES as readonly SpaceType[] },
} as const;

export function SpaceTypeGrid({
  value,
  onChange,
  onPick,
  first = 'exterior',
}: {
  value: SpaceType | null;
  onChange: (t: SpaceType) => void;
  /** Double-click / double-tap a tile. */
  onPick?: (t: SpaceType) => void;
  first?: 'interior' | 'exterior';
}) {
  const order = first === 'interior' ? (['interior', 'exterior'] as const) : (['exterior', 'interior'] as const);
  return (
    <div className="flex flex-col gap-5">
      {order.map((k) => (
        <fieldset key={k} className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{GROUPS[k].title}</legend>
          <div role="radiogroup" aria-label={GROUPS[k].title} className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
            {GROUPS[k].types.map((t, i) => {
              const Icon = SPACE_ICONS[t];
              const selected = value === t;
              // The modal focuses this tile first (instead of the name field, which would pop up a phone keyboard).
              const autoFocus = value ? selected : k === order[0] && i === 0;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-autofocus={autoFocus || undefined}
                  onClick={() => onChange(t)}
                  onDoubleClick={() => onPick?.(t)}
                  className={cn(
                    'flex min-h-[4.75rem] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                    selected ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-text hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <Icon className={cn('size-5', selected ? 'text-accent' : 'text-muted')} aria-hidden />
                  <span className="text-[13px] font-medium leading-tight">{SPACE_TYPE_LABELS[t]}</span>
                  {SPACE_HINTS[t] && <span className={cn('text-[10.5px] leading-tight', selected ? 'text-accent/80' : 'text-subtle')}>{SPACE_HINTS[t]}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function AddSpaceModal() {
  const open = useShellUI((s) => s.addSpaceOpen);
  return open ? <AddSpaceForm /> : null;
}

function AddSpaceForm() {
  const kind = useShellUI((s) => s.addSpaceKind);
  const [type, setType] = useState<SpaceType | null>(null);
  const [name, setName] = useState('');

  const add = (t: SpaceType | null, withPhotos: boolean) => {
    if (!t) return;
    const s = useStore.getState();
    const id = s.addSpace(t, name.trim() || undefined);
    // Must run inside the click so the browser allows the file dialog.
    if (withPhotos) pickPhotos(id);
    if (!isDesktopViewport()) s.setView({ mobilePane: 'editor' });
    closeAddSpace();
  };

  return (
    <Modal
      open
      onClose={closeAddSpace}
      title="Add a space"
      size="lg"
      footer={
        <>
          <Button onClick={() => add(type, false)} disabled={!type}>
            Add space
          </Button>
          <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => add(type, true)} disabled={!type}>
            Add & choose photos
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          A space is one room or outdoor area. It keeps its own photos, scene maps and design options — add several photos from
          different angles if you like.
        </p>
        <SpaceTypeGrid value={type} onChange={setType} onPick={(t) => add(t, false)} first={kind ?? 'exterior'} />
        <Field label="Name (optional)" hint={type ? `Leave empty to call it “${SPACE_TYPE_LABELS[type]}”.` : 'Pick a type first.'}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type ? SPACE_TYPE_LABELS[type] : 'e.g. Primary bedroom, Side garden'}
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(type, false);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** Change a space's type (interior ↔ exterior follows the type). */
export function SpaceTypeModal({ spaceId, current, onClose }: { spaceId: string; current: SpaceType; onClose: () => void }) {
  const [type, setType] = useState<SpaceType>(current);
  const save = (t: SpaceType) => {
    if (t !== current) useStore.getState().updateSpace(spaceId, { type: t });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Change space type"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => save(type)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">The type decides which design elements and suggestions Mode offers for this space.</p>
        <SpaceTypeGrid value={type} onChange={setType} onPick={save} first={spaceKindOf(current)} />
      </div>
    </Modal>
  );
}
