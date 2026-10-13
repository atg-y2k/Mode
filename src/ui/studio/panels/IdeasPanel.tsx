/**
 * Ideas — the project-wide idea board: inspiration images (file, paste or
 * drop; colors extracted, described by AI), notes, design themes from the
 * knowledge base, and real products (AI store search in the Shop modal or a
 * pasted product link). Active items feed generations and suggestions.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, ImagePlus, Lightbulb, Link2, Palette, ShoppingBag, Sparkles, StickyNote, Trash2, Upload } from 'lucide-react';
import type { IdeaItem, IdeaKind, Project, Space } from '../../../../shared/types';
import { getTheme } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { isEditableTarget } from '../../shell/format';
import { dragHasFiles, isImageFile } from '../../shell/photoImport';
import { Badge, Button, ConfirmModal, EmptyState, IconButton, PanelHeader, Section, Segmented, Select, Swatch, TextArea, TextInput, Toggle, cn } from '../../common';
import { useAiJob } from './aiJobs';
import { useStudioContext } from './context';
import { PRODUCT_LINK_JOB, addImageIdeas, addNoteIdea, describeIdeaItem, describeJobKey, importProductLink } from './ideas';
import { normalizeProductUrl, priceLabel, storeLabel, urlHost } from './productInfo';
import { ThemePickerModal } from './ThemePickerModal';
import { AiJobStatus, BlobImage, InlineText, useAiReady } from './ui';

type Filter = 'space' | 'all';

const KIND_LABELS: Record<IdeaKind, string> = { image: 'Image', note: 'Note', product: 'Product', theme: 'Theme' };

export function IdeasPanel() {
  const { project, space, setting } = useStudioContext();
  if (!project) return null;
  return <IdeaBoard project={project} space={space} setting={setting} />;
}

function IdeaBoard({ project, space, setting }: { project: Project; space: Space | undefined; setting: 'interior' | 'exterior' }) {
  const [filter, setFilter] = useState<Filter>('space');
  const [dragging, setDragging] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const board = project.ideaBoard;
  /** New items belong to the whole house; the scope can be narrowed per card. */
  const newScope: string[] = [];

  const forSpace = useMemo(() => (space ? board.filter((i) => i.spaceIds.length === 0 || i.spaceIds.includes(space.id)) : board), [board, space]);
  const effectiveFilter: Filter = space ? filter : 'all';
  const items = useMemo(() => [...(effectiveFilter === 'space' ? forSpace : board)].sort((a, b) => b.createdAt - a.createdAt), [effectiveFilter, forSpace, board]);

  // Paste images anywhere while the board is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
      // Text fields keep their own paste; so does any open dialog (Settings, Shop…).
      if (files.length === 0 || isEditableTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      void addImageIdeas(files, []);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const onDragEnter = (e: DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void addImageIdeas(Array.from(e.dataTransfer.files), newScope);
  };

  return (
    <div
      className="relative flex min-h-full flex-col"
      onDragEnter={onDragEnter}
      onDragOver={(e) => {
        if (dragHasFiles(e)) e.preventDefault();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <PanelHeader title="Idea board" subtitle="Inspiration for the whole house — images, notes, design themes and real products. Active ideas guide every generation." />

      <Section title="Add to the board">
        <div className="grid grid-cols-2 gap-2">
          <AddTile icon={<ImagePlus className="size-[18px]" />} label="Image" hint="Photo or screenshot" onClick={() => fileRef.current?.click()} />
          <AddTile icon={<StickyNote className="size-[18px]" />} label="Note" hint="Words, wishes, rules" onClick={() => setNoteOpen(true)} active={noteOpen} />
          <AddTile icon={<Palette className="size-[18px]" />} label="Design theme" hint="Curated looks" onClick={() => setThemesOpen(true)} />
          <AddTile
            icon={<ShoppingBag className="size-[18px]" />}
            label="Find products"
            hint="Home Depot, Lowe's, nurseries"
            onClick={() => useStore.getState().openShop({ category: setting === 'exterior' ? 'plant' : 'lighting' })}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void addImageIdeas(files, newScope);
          }}
        />
        {noteOpen && <NoteComposer onDone={() => setNoteOpen(false)} />}
        <ProductLinkForm />
        <p className="text-[11px] text-subtle">Tip: paste or drop images anywhere on this panel.</p>
      </Section>

      <section className="flex flex-1 flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Your ideas <span className="font-normal tabular-nums text-subtle">· {items.length}</span>
          </h3>
          {space && (
            <Segmented
              size="sm"
              className="shrink-0"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'space', label: 'This space', title: `Ideas for ${space.name} and the whole house (${forSpace.length})` },
                { value: 'all', label: 'All', title: `Every idea in the project (${board.length})` },
              ]}
            />
          )}
        </div>
        {items.length === 0 ? (
          <EmptyState icon={<Lightbulb className="size-6" />} title={board.length ? 'Nothing for this space yet' : 'Your idea board is empty'}>
            {board.length
              ? 'Every idea here is scoped to another space. Switch to “All”, or add something for this space.'
              : 'Collect what you love: a photo of a neighbor’s walkway, a paint chip, a design theme, the exact light fixture. Mode uses it to shape your variations.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <IdeaCard key={item.id} item={item} project={project} />
            ))}
          </ul>
        )}
      </section>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-accent-soft/90 text-accent">
          <Upload className="size-7" aria-hidden />
          <p className="text-sm font-medium">Drop images to add them to your idea board</p>
        </div>
      )}

      <ThemePickerModal open={themesOpen} onClose={() => setThemesOpen(false)} defaultSetting={setting} />
    </div>
  );
}

function AddTile({ icon, label, hint, onClick, active }: { icon: ReactNode; label: string; hint: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/50',
      )}
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block truncate text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

function NoteComposer({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !note.trim()) return;
    setSaving(true);
    try {
      await addNoteIdea(title, note, []);
      onDone();
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <TextInput autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. “Low-maintenance front yard”" aria-label="Note title" />
      <TextArea
        value={note}
        rows={3}
        maxLength={2000}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should every design respect? e.g. “Kids play on the lawn — keep it open. No thorny plants near the walk.”"
        aria-label="Note"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" className="max-lg:h-9" variant="primary" type="submit" loading={saving} disabled={!title.trim() && !note.trim()}>
          Add note
        </Button>
      </div>
    </form>
  );
}

function ProductLinkForm() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const job = useAiJob(PRODUCT_LINK_JOB);
  const busy = job?.status === 'running';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeProductUrl(url);
    if (!normalized) {
      setError('Paste a full product link, like https://www.homedepot.com/p/…');
      return;
    }
    setError(null);
    if (await importProductLink(normalized, [])) setUrl('');
  };
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <TextInput
            value={url}
            inputMode="url"
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="Paste a product link"
            aria-label="Product link (Home Depot, Lowe's, a nursery…)"
            aria-invalid={!!error}
            className="pl-8"
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={!url.trim() || busy}>
          Add
        </Button>
      </form>
      {error && <p className="text-xs text-danger">{error}</p>}
      <AiJobStatus
        jobKey={PRODUCT_LINK_JOB}
        hint="Reading the name, price, specs and photo from the store page."
        onRetry={() => {
          const normalized = normalizeProductUrl(url);
          if (normalized) void importProductLink(normalized, []);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function IdeaCard({ item, project }: { item: IdeaItem; project: Project }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const describeJob = useAiJob(describeJobKey(item.id));
  const aiReady = useAiReady();
  const theme = item.kind === 'theme' && item.themeId ? getTheme(item.themeId) : undefined;
  const update = (patch: Partial<Omit<IdeaItem, 'id'>>) => useStore.getState().updateIdeaItem(item.id, patch, {});
  const p = item.product;
  const price = p ? priceLabel(p) : null;
  const host = p ? urlHost(p.url) : null;

  return (
    <li className={cn('overflow-hidden rounded-2xl border bg-surface transition-opacity', item.active ? 'border-line' : 'border-dashed border-line-strong')}>
      {item.thumbId ? (
        <div className={cn('aspect-[16/10] w-full bg-surface-2', !item.active && 'opacity-60')}>
          <BlobImage imageId={item.imageId ?? item.thumbId} alt={item.title} fit={item.kind === 'product' ? 'contain' : 'cover'} className={item.kind === 'product' ? 'bg-white' : undefined} />
        </div>
      ) : item.kind === 'theme' && item.colors.length > 0 ? (
        <div className={cn('flex h-12 w-full', !item.active && 'opacity-60')} aria-hidden>
          {item.colors.map((c, i) => (
            <span key={`${c}${i}`} className="h-full flex-1" style={{ backgroundColor: c }} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <InlineText value={item.title} label="Rename idea" placeholder="Untitled idea" className="max-w-full text-sm font-medium text-text" onCommit={(title) => update({ title })} />
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={item.kind === 'product' ? 'accent' : 'neutral'}>{KIND_LABELS[item.kind]}</Badge>
              {p && <span className="text-[11px] font-medium text-muted">{storeLabel(p)}</span>}
              {price && <span className="text-[11px] font-semibold text-text">{price}</span>}
            </div>
          </div>
          <IconButton label={`Delete ${item.title || 'idea'}`} size="sm" className="max-lg:size-9" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>

        {p && (
          <div className="flex flex-col gap-1.5">
            {p.specs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.specs.slice(0, expanded ? 12 : 4).map((s) => (
                  <span key={s} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                    {s}
                  </span>
                ))}
              </div>
            )}
            <a
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Open at {host ?? storeLabel(p)} <ExternalLink className="size-3" aria-hidden />
            </a>
            <p className="text-[10.5px] text-subtle">
              Price as found {new Date(p.retrievedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — check the store for current pricing.
            </p>
          </div>
        )}

        {theme && (
          <div className="flex flex-col gap-1 text-xs text-muted">
            <p className="text-text">{theme.purpose}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {theme.principles.slice(0, expanded ? undefined : 2).map((pr) => (
                <li key={pr}>{pr}</li>
              ))}
            </ul>
          </div>
        )}

        {item.colors.length > 0 && item.kind !== 'theme' && (
          <div className="flex gap-1" aria-label="Colors">
            {item.colors.map((c, i) => (
              <Swatch key={`${c}${i}`} hex={c} size="sm" title={c} />
            ))}
          </div>
        )}

        {item.aiDescription && item.kind !== 'theme' && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className={cn('text-left text-xs leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-accent', !expanded && 'line-clamp-3')}
          >
            {item.kind === 'image' && <Sparkles className="mr-1 inline size-3 text-accent" aria-label="AI description" />}
            {item.aiDescription}
          </button>
        )}
        {(theme || (p && p.specs.length > 4)) && !item.aiDescription && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="self-start text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {item.kind === 'image' && <AiJobStatus jobKey={describeJobKey(item.id)} hint="Style, materials, plants and colors — used in your generations." onRetry={() => describeIdeaItem(item.id)} />}
        {item.kind === 'image' && !item.aiDescription && !describeJob && aiReady && (
          <Button size="sm" variant="soft" className="self-start max-lg:h-9" icon={<Sparkles className="size-3.5" />} onClick={() => describeIdeaItem(item.id)}>
            Describe with AI
          </Button>
        )}

        <TextArea
          value={item.note}
          rows={2}
          maxLength={2000}
          aria-label="Your note"
          placeholder={item.kind === 'product' ? 'Where would it go? e.g. “two by the front steps”' : 'What do you like about it?'}
          onChange={(e) => useStore.getState().updateIdeaItem(item.id, { note: e.target.value })}
          className="min-h-14 text-xs"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <Toggle checked={item.active} onChange={(active) => update({ active })} label={<span className="text-xs text-muted">Use in generations</span>} />
          <ScopeSelect item={item} spaces={project.spaces} onChange={(spaceIds) => update({ spaceIds })} />
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Remove this idea?"
        message="It's removed from the idea board and from any brief that uses it. This can't be undone."
        confirmLabel="Remove"
        onConfirm={() => void useStore.getState().removeIdeaItem(item.id)}
      />
    </li>
  );
}

function ScopeSelect({ item, spaces, onChange }: { item: IdeaItem; spaces: Space[]; onChange: (spaceIds: string[]) => void }) {
  const known = item.spaceIds.filter((id) => spaces.some((s) => s.id === id));
  return (
    <Select
      value={known[0] ?? ''}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      aria-label="Applies to"
      className="h-8 w-auto max-w-[11rem] py-0 pl-2 text-xs"
    >
      <option value="">Whole house</option>
      {spaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {known.length > 1 && s.id === known[0] ? ` (+${known.length - 1})` : ''}
        </option>
      ))}
    </Select>
  );
}
