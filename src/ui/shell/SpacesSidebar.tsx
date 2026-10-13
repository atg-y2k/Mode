/**
 * Spaces sidebar: Inside / Outside groups of spaces; each space expands to
 * its photo thumbnails (scene-map badge, favorites count, live "mapping" /
 * "generating" state). Add photos with the picker or by dropping files on a
 * space. Space menu: rename, change type, notes, add photos, delete. Photo
 * menu: rename, (re-)map scene, delete. Footer: the project's location /
 * hardiness zone (plant feasibility) with a shortcut to Settings.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import {
  ChevronRight,
  ImagePlus,
  Loader2,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  ScanSearch,
  Shapes,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { SPACE_TYPE_LABELS, type Photo, type Space } from '../../../shared/types';
import { findSpace, useStore } from '../../state/store';
import { Button, ConfirmModal, Field, Modal, TextArea, TextInput, cn } from '../common';
import { SpaceTypeModal } from './AddSpaceModal';
import { plural } from './format';
import { useBlobUrl } from './hooks';
import { Menu, type MenuEntry } from './Menu';
import { dragHasFiles, importPhotosToSpace, pickPhotos } from './photoImport';
import { requestSceneAnalysis, useSceneJob } from './sceneJobs';
import { openAddSpace, openSettings } from './shellUI';
import { SPACE_ICONS } from './spaceMeta';
import { ProjectName, SaveStatus } from './TopBar';

const EMPTY_SPACES: Space[] = [];

type Dialog =
  | { kind: 'type'; spaceId: string }
  | { kind: 'notes'; spaceId: string }
  | { kind: 'delete-space'; spaceId: string }
  | { kind: 'rename-photo'; photoId: string }
  | { kind: 'delete-photo'; photoId: string }
  | null;

export function SpacesSidebar({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const spaces = useStore((s) => s.project?.spaces ?? EMPTY_SPACES);
  const activeSpaceId = useStore((s) => s.selection.spaceId);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  const interior = spaces.filter((s) => s.kind === 'interior');
  const exterior = spaces.filter((s) => s.kind === 'exterior');
  const isExpanded = (id: string) => expanded[id] ?? id === activeSpaceId;

  const onRowClick = (space: Space) => {
    const s = useStore.getState();
    if (s.selection.spaceId === space.id) {
      setExpanded((e) => ({ ...e, [space.id]: !isExpanded(space.id) }));
    } else {
      s.selectSpace(space.id);
      setExpanded((e) => ({ ...e, [space.id]: true }));
    }
  };

  const dropFiles = (spaceId: string, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const files = Array.from(e.dataTransfer.files);
    setExpanded((x) => ({ ...x, [spaceId]: true }));
    void importPhotosToSpace(spaceId, files);
  };

  const rowDnd = (spaceId: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      if (dragOverId !== spaceId) setDragOverId(spaceId);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragOverId((cur) => (cur === spaceId ? null : cur));
    },
    onDrop: (e: DragEvent) => dragHasFiles(e) && dropFiles(spaceId, e),
  });

  const spaceMenu = (space: Space): MenuEntry[] => [
    { label: 'Add photos…', icon: <ImagePlus className="size-4" />, onSelect: () => pickPhotos(space.id) },
    { kind: 'separator' },
    { label: 'Rename', icon: <Pencil className="size-4" />, onSelect: () => setRenamingId(space.id) },
    { label: 'Change type…', icon: <Shapes className="size-4" />, hint: SPACE_TYPE_LABELS[space.type], onSelect: () => setDialog({ kind: 'type', spaceId: space.id }) },
    {
      label: 'Notes…',
      icon: <NotebookPen className="size-4" />,
      hint: space.notes?.trim() ? space.notes.trim() : 'What to keep, how you use it…',
      onSelect: () => setDialog({ kind: 'notes', spaceId: space.id }),
    },
    { kind: 'separator' },
    { label: 'Delete space…', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDialog({ kind: 'delete-space', spaceId: space.id }) },
  ];

  const renderGroup = (title: string, kind: 'interior' | 'exterior', list: Space[], emptyHint: string) => (
    <section className="flex flex-col gap-1" aria-label={title}>
      <div className="flex items-center justify-between px-2 pb-0.5 pt-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {title}
          {list.length > 0 && <span className="ml-1.5 font-normal tabular-nums">{list.length}</span>}
        </h3>
        <button
          type="button"
          onClick={() => openAddSpace(kind)}
          aria-label={`Add ${kind === 'interior' ? 'a room' : 'an outdoor area'}`}
          title={`Add ${kind === 'interior' ? 'a room' : 'an outdoor area'}`}
          className="inline-flex size-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {list.length === 0 ? (
        <button
          type="button"
          onClick={() => openAddSpace(kind)}
          className="mx-1 rounded-lg border border-dashed border-line px-3 py-2.5 text-left text-xs text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          {emptyHint}
        </button>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {list.map((space) => (
            <SpaceRow
              key={space.id}
              space={space}
              active={space.id === activeSpaceId}
              expanded={isExpanded(space.id)}
              renaming={renamingId === space.id}
              dragOver={dragOverId === space.id}
              dnd={rowDnd(space.id)}
              menu={spaceMenu(space)}
              onClick={() => onRowClick(space)}
              onRenameDone={() => setRenamingId(null)}
              onPhotoDialog={setDialog}
              wide={variant === 'mobile'}
            />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <nav
      aria-label="Spaces"
      className={cn('flex h-full min-h-0 flex-col bg-surface', variant === 'desktop' ? 'w-56 shrink-0 border-r border-line xl:w-64' : 'w-full')}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = spaces.length ? 'copy' : 'none';
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        const target = activeSpaceId ?? spaces[0]?.id;
        if (target) dropFiles(target, e);
        else {
          e.preventDefault();
          useStore.getState().notify('Add a space first, then drop photos onto it.', 'info');
        }
      }}
    >
      {variant === 'mobile' && (
        <div className="flex flex-col gap-0.5 border-b border-line px-3 pb-3 pt-3">
          <ProjectName className="-ml-2 max-w-full self-start" large />
          <SaveStatus />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
        <h2 className="font-display text-base text-text">Spaces</h2>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => openAddSpace()}>
          Add space
        </Button>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1.5 pb-3 pt-1">
        {spaces.length === 0 ? (
          <NoSpacesYet />
        ) : (
          <>
            {renderGroup('Inside', 'interior', interior, 'Add a room — living room, kitchen, bedroom…')}
            {renderGroup('Outside', 'exterior', exterior, 'Add the front of the house, a yard, a patio…')}
          </>
        )}
      </div>
      <LocationFooter />
      <SidebarDialogs dialog={dialog} onClose={closeDialog} />
    </nav>
  );
}

function NoSpacesYet() {
  return (
    <div className="mx-1.5 mt-2 flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-4">
      <p className="text-sm font-medium text-text">No spaces yet</p>
      <p className="text-xs leading-relaxed text-muted">
        A space is a room or an outdoor area. Add one, then upload photos of it — inside and outside are both welcome.
      </p>
      <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openAddSpace()}>
        Add a space
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Space row
// ---------------------------------------------------------------------------

function SpaceRow({
  space,
  active,
  expanded,
  renaming,
  dragOver,
  dnd,
  menu,
  onClick,
  onRenameDone,
  onPhotoDialog,
  wide,
}: {
  space: Space;
  active: boolean;
  expanded: boolean;
  renaming: boolean;
  dragOver: boolean;
  dnd: Pick<HTMLAttributes<HTMLLIElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
  menu: MenuEntry[];
  onClick: () => void;
  onRenameDone: () => void;
  onPhotoDialog: (d: Dialog) => void;
  /** Full-width (phone) layout: more thumbnails per row. */
  wide: boolean;
}) {
  const Icon = SPACE_ICONS[space.type];
  const generating = useStore((s) => space.photos.some((p) => p.generations.some((g) => !!s.runs[g.id])));
  const panelId = `space-photos-${space.id}`;
  return (
    <li
      {...dnd}
      className={cn('rounded-xl transition-colors', dragOver && 'bg-accent-soft ring-2 ring-accent ring-inset', active && !dragOver && 'bg-surface-2/70')}
    >
      <div className="group/row flex items-center gap-1 pr-1">
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2">
            <Icon className="size-4 shrink-0 text-accent" aria-hidden />
            <InlineRename
              value={space.name}
              label="Space name"
              onDone={(name) => {
                if (name && name !== space.name) useStore.getState().updateSpace(space.id, { name });
                onRenameDone();
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onClick}
            onDoubleClick={(e) => e.preventDefault()}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-current={active ? 'true' : undefined}
            className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ChevronRight className={cn('size-3.5 shrink-0 text-subtle transition-transform', expanded && 'rotate-90')} aria-hidden />
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-lg',
                active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted group-hover/row:text-text',
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm', active ? 'font-semibold text-text' : 'font-medium text-text')}>{space.name}</span>
              <span className="block truncate text-[11px] text-subtle">
                {space.name === SPACE_TYPE_LABELS[space.type] ? plural(space.photos.length, 'photo') : `${SPACE_TYPE_LABELS[space.type]} · ${plural(space.photos.length, 'photo')}`}
              </span>
            </span>
            {generating && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-label="Generating variations" />}
          </button>
        )}
        <Menu
          label={`Actions for ${space.name}`}
          items={menu}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent aria-expanded:bg-surface-3"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
        />
      </div>
      {expanded && (
        <div id={panelId} className="px-2 pb-2.5 pt-1">
          <PhotoGrid space={space} onPhotoDialog={onPhotoDialog} wide={wide} />
        </div>
      )}
    </li>
  );
}

function InlineRename({ value, label, onDone }: { value: string; label: string; onDone: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v.trim());
  };
  return (
    <input
      ref={ref}
      value={draft}
      aria-label={label}
      maxLength={60}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(draft);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(value);
        }
      }}
      className="h-8 min-w-0 flex-1 rounded-md border border-accent bg-surface px-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
    />
  );
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

function PhotoGrid({ space, onPhotoDialog, wide }: { space: Space; onPhotoDialog: (d: Dialog) => void; wide: boolean }) {
  const activePhotoId = useStore((s) => s.selection.photoId);
  if (!space.photos.length) {
    return (
      <button
        type="button"
        onClick={() => pickPhotos(space.id)}
        className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 py-4 text-center transition-colors hover:border-accent hover:bg-accent-soft/60 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Upload className="size-4 text-accent" aria-hidden />
        <span className="text-xs font-medium text-text">Add photos</span>
        <span className="text-[11px] leading-snug text-muted">or drop them here</span>
      </button>
    );
  }
  return (
    <ul className={cn('grid gap-1.5', wide ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2')}>
      {space.photos.map((p) => (
        <PhotoThumb key={p.id} photo={p} active={p.id === activePhotoId} onDialog={onPhotoDialog} />
      ))}
      <li>
        <button
          type="button"
          onClick={() => pickPhotos(space.id)}
          title="Add photos (or drop files on this space)"
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-muted transition-colors hover:border-accent hover:bg-accent-soft/60 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ImagePlus className="size-4" aria-hidden />
          <span className="text-[11px] font-medium">Add</span>
        </button>
      </li>
    </ul>
  );
}

function PhotoThumb({ photo, active, onDialog }: { photo: Photo; active: boolean; onDialog: (d: Dialog) => void }) {
  const thumb = useBlobUrl(photo.thumbId);
  const job = useSceneJob(photo.id);
  const aiEnabled = useStore((s) => !!s.health?.ai.enabled);
  const generating = useStore((s) => photo.generations.some((g) => !!s.runs[g.id]));
  const favorites = photo.generations.reduce((n, g) => n + g.variations.filter((v) => v.favorite).length, 0);
  const variations = photo.generations.reduce((n, g) => n + g.variations.length, 0);
  const zones = photo.scene?.zones.length ?? 0;

  const status: ReactNode = generating ? (
    <StatusChip>
      <Loader2 className="size-3 animate-spin" aria-hidden /> Generating
    </StatusChip>
  ) : job ? (
    <StatusChip>
      <Loader2 className="size-3 animate-spin" aria-hidden /> {job === 'queued' ? 'Queued' : 'Mapping…'}
    </StatusChip>
  ) : photo.scene ? (
    <StatusChip title={`Scene mapped — ${plural(zones, 'area')}`}>
      <ScanSearch className="size-3" aria-hidden />
      <span className="sr-only">Scene mapped</span>
    </StatusChip>
  ) : null;

  const description = [
    photo.scene ? `scene mapped (${plural(zones, 'area')})` : 'scene not mapped yet',
    variations ? plural(variations, 'variation') : null,
    favorites ? plural(favorites, 'favorite') : null,
  ]
    .filter(Boolean)
    .join(', ');

  const items: MenuEntry[] = [
    { label: 'Rename…', icon: <Pencil className="size-4" />, onSelect: () => onDialog({ kind: 'rename-photo', photoId: photo.id }) },
    {
      label: photo.scene ? 'Re-map scene' : 'Map scene',
      hint: !aiEnabled ? 'Needs AI (see Settings)' : job ? 'Already running' : photo.scene ? 'Replaces the current map (undoable)' : 'Find areas, paths and architecture',
      icon: <ScanSearch className="size-4" />,
      disabled: !aiEnabled || !!job,
      onSelect: () => {
        if (requestSceneAnalysis(photo.id, { force: true })) useStore.getState().notify(`Mapping the scene of “${photo.name}”…`, 'info');
      },
    },
    { kind: 'separator' },
    { label: 'Delete photo…', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => onDialog({ kind: 'delete-photo', photoId: photo.id }) },
  ];

  return (
    <li className="group/photo relative">
      <button
        type="button"
        onClick={() => useStore.getState().selectPhoto(photo.id)}
        aria-current={active ? 'true' : undefined}
        aria-label={`${photo.name}: ${description}`}
        title={photo.name}
        className={cn(
          'relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface-3 transition-shadow',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          active ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'hover:ring-1 hover:ring-line-strong',
        )}
      >
        {thumb.status === 'ready' ? (
          <img src={thumb.url} alt="" draggable={false} className="size-full object-cover" />
        ) : thumb.status === 'loading' ? (
          <span className="block size-full animate-pulse bg-surface-3" />
        ) : (
          <span className="flex size-full items-center justify-center text-[10px] text-subtle">No preview</span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-left">
          <span className="block truncate text-[10.5px] font-medium text-white">{photo.name}</span>
        </span>
        <span className="pointer-events-none absolute left-1 top-1 flex gap-1">{status}</span>
        {favorites > 0 && (
          <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <Star className="size-2.5 fill-current text-gold" aria-hidden />
            {favorites}
          </span>
        )}
      </button>
      <div className="absolute right-0.5 top-0.5 opacity-0 transition-opacity group-hover/photo:opacity-100 group-focus-within/photo:opacity-100 [@media(hover:none)]:opacity-100">
        <Menu
          label={`Actions for ${photo.name}`}
          items={items}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white aria-expanded:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
        />
      </div>
    </li>
  );
}

function StatusChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function LocationFooter() {
  const zip = useStore((s) => s.project?.location.zip);
  const zone = useStore((s) => s.project?.location.hardinessZone ?? s.project?.location.climate?.hardinessZone);
  const hasExterior = useStore((s) => !!s.project?.spaces.some((sp) => sp.kind === 'exterior'));
  const label = zone ? `USDA zone ${zone}${zip ? ` · ${zip}` : ''}` : zip ? `ZIP ${zip} · zone unknown` : 'Add your ZIP code';
  const hint = zone ? 'Plant ideas are checked against your zone' : hasExterior ? 'So plant ideas fit your climate' : 'For climate-aware plant ideas';
  return (
    <div className="border-t border-line p-2">
      <button
        type="button"
        onClick={() => openSettings('project')}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <MapPin className={cn('size-4 shrink-0', zone ? 'text-accent' : 'text-subtle')} aria-hidden />
        <span className="min-w-0">
          <span className={cn('block truncate text-xs font-medium', zone ? 'text-text' : 'text-muted')}>{label}</span>
          <span className="block truncate text-[11px] text-subtle">{hint}</span>
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function SidebarDialogs({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const project = useStore((s) => s.project);
  if (!dialog || !project) return null;

  if (dialog.kind === 'type' || dialog.kind === 'notes' || dialog.kind === 'delete-space') {
    const space = findSpace(project, dialog.spaceId);
    if (!space) return null;
    if (dialog.kind === 'type') return <SpaceTypeModal spaceId={space.id} current={space.type} onClose={onClose} />;
    if (dialog.kind === 'notes') return <SpaceNotesModal space={space} onClose={onClose} />;
    const n = space.photos.length;
    return (
      <ConfirmModal
        open
        title="Delete space?"
        message={
          <>
            <strong className="text-text">“{space.name}”</strong>
            {n ? ` and its ${plural(n, 'photo')} — with their scene maps, variations and design options — ` : ' '}
            will be removed from this project. This can’t be undone.
          </>
        }
        confirmLabel="Delete space"
        onClose={onClose}
        onConfirm={() => void useStore.getState().deleteSpace(space.id)}
      />
    );
  }

  const photoId = dialog.photoId;
  const photo = project.spaces.flatMap((s) => s.photos).find((p) => p.id === photoId);
  if (!photo) return null;
  if (dialog.kind === 'rename-photo') return <RenamePhotoModal photo={photo} onClose={onClose} />;
  const variations = photo.generations.reduce((n, g) => n + g.variations.length, 0);
  return (
    <ConfirmModal
      open
      title="Delete photo?"
      message={
        <>
          <strong className="text-text">“{photo.name}”</strong>
          {variations ? ` and its ${plural(variations, 'variation')}, scene map and design options` : ' and its scene map and design options'} will be
          removed. This can’t be undone.
        </>
      }
      confirmLabel="Delete photo"
      onClose={onClose}
      onConfirm={() => void useStore.getState().deletePhoto(photo.id)}
    />
  );
}

function SpaceNotesModal({ space, onClose }: { space: Space; onClose: () => void }) {
  const [notes, setNotes] = useState(space.notes ?? '');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Notes — ${space.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (notes.trim() !== (space.notes ?? '').trim()) useStore.getState().updateSpace(space.id, { notes: notes.trim() });
              onClose();
            }}
          >
            Save notes
          </Button>
        </>
      }
    >
      <Field label="Notes for this space" hint="Shared with the AI when mapping the scene and planning designs.">
        <TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder={
            space.kind === 'exterior'
              ? 'e.g. Keep the maple. Deer visit nightly. We enter from the driveway side. Low-maintenance please.'
              : 'e.g. Keep the oak floors. Kids and a dog. Room gets afternoon sun. Love warm, natural materials.'
          }
        />
      </Field>
    </Modal>
  );
}

function RenamePhotoModal({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [name, setName] = useState(photo.name);
  const save = () => {
    const v = name.trim();
    if (v && v !== photo.name) useStore.getState().renamePhoto(photo.id, v);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Rename photo"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      </form>
    </Modal>
  );
}
