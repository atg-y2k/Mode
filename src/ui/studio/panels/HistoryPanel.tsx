/**
 * History — every run on the photo, newest first: Claude's plan, the
 * variations (view, favorite), the brief that produced them, the plant
 * feasibility notes, provider / model and time. Runs can be re-run with the
 * same brief, their brief restored for editing, or deleted. A favorites
 * filter shows only the keepers.
 */
import { useMemo, useState } from 'react';
import { Copy, GitCompare, History, ImagePlus, LayoutGrid, Loader2, RotateCcw, Sparkles, Star, Trash2, TriangleAlert } from 'lucide-react';
import type { Generation, Photo, PlantNote, SceneMap, Variation } from '../../../../shared/types';
import { getElementDef } from '../../../assets/design';
import { findVariation, useStore } from '../../../state/store';
import { relativeTime } from '../../shell/format';
import { pickPhotos } from '../../shell/photoImport';
import { Badge, Button, ConfirmModal, EmptyState, IconButton, PanelHeader, Segmented, cn } from '../../common';
import { cancelRun, generationBlocker } from '../generate';
import { openRunGrid, rerunGeneration, restoreBrief, viewVariation } from './actions';
import { summarizeBrief } from './briefOps';
import { useStudioContext } from './context';
import { BlobImage, FEASIBILITY_META, FeasibilityBadge } from './ui';

type Filter = 'all' | 'favorites';

export function HistoryPanel() {
  const { project, space, photo, scene } = useStudioContext();
  if (!project) return null;
  if (!space || !photo) {
    return (
      <EmptyState
        icon={<History className="size-6" />}
        title="No runs yet"
        action={
          space && (
            <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => pickPhotos(space.id)}>
              Add photos
            </Button>
          )
        }
      >
        Every generation of a photo is kept here with its plan, brief and plant notes.
      </EmptyState>
    );
  }
  return <RunList photo={photo} scene={scene} />;
}

function RunList({ photo, scene }: { photo: Photo; scene: SceneMap | undefined }) {
  const [filter, setFilter] = useState<Filter>('all');
  const favorites = useMemo(() => photo.generations.reduce((n, g) => n + g.variations.filter((v) => v.favorite).length, 0), [photo.generations]);
  const runs = filter === 'favorites' ? photo.generations.filter((g) => g.variations.some((v) => v.favorite)) : photo.generations;

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader title="History" subtitle="Every run on this photo — its plan, brief and plant notes." />
      {photo.generations.length > 0 && (
        <div className="px-4 pt-3">
          <Segmented
            size="sm"
            className="w-full"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All runs · ${photo.generations.length}` },
              {
                value: 'favorites',
                label: (
                  <>
                    <Star className="size-3" aria-hidden /> Favorites · {favorites}
                  </>
                ),
              },
            ]}
          />
        </div>
      )}
      {photo.generations.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title="Nothing generated yet"
          action={
            <Button variant="primary" onClick={() => useStore.getState().setStudio({ panel: 'design' })}>
              Compose a brief
            </Button>
          }
        >
          Compose a brief on the Design tab and generate — every run lands here so you can compare, re-run and pick favorites.
        </EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState icon={<Star className="size-6" />} title="No favorites yet">
          Star the variations you like (in the strip below the photo or here) to find them quickly.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3 px-4 py-4">
          {runs.map((g) => (
            <RunCard key={g.id} g={g} photo={photo} scene={scene} favoritesOnly={filter === 'favorites'} />
          ))}
        </ul>
      )}
    </div>
  );
}

function compareLabel(g: Generation): string | null {
  if (g.mode !== 'compare' || !g.compare) return null;
  const el = g.brief.elements.find((e) => e.id === g.compare?.elementId);
  if (!el) return 'Compare';
  const dim = el.dimensions.find((d) => d.id === g.compare?.dimensionId) ?? getElementDef(el.type).dimensions.find((d) => d.id === g.compare?.dimensionId);
  return dim ? `${el.label} · ${dim.label}` : el.label;
}

function RunCard({ g, photo, scene, favoritesOnly }: { g: Generation; photo: Photo; scene: SceneMap | undefined; favoritesOnly: boolean }) {
  const progress = useStore((s) => s.runs[g.id]);
  const viewing = useStore((s) => s.studio.viewVariationId);
  const health = useStore((s) => s.health);
  const blocker = generationBlocker({ health });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showPlants, setShowPlants] = useState(false);
  const [starting, setStarting] = useState(false);
  const cmp = compareLabel(g);
  const variations = favoritesOnly ? g.variations.filter((v) => v.favorite) : g.variations;
  const pending = progress ? Math.max(0, progress.total - progress.done - progress.failed) : 0;
  const base = g.baseVariationId ? findVariation(photo, g.baseVariationId) : undefined;
  const title = cmp ?? (g.variations[0]?.title || (g.brief.prompt.trim() ? g.brief.prompt.trim().split('\n')[0] : 'Variations'));
  const notes = g.plantNotes ?? [];
  const flagged = notes.filter((n) => n.rating !== 'good').length;

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {g.mode === 'compare' ? <GitCompare className="size-[18px]" aria-hidden /> : <Sparkles className="size-[18px]" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-text">{title}</p>
          <p className="mt-0.5 text-[11px] text-subtle" title={new Date(g.createdAt).toLocaleString()}>
            {relativeTime(g.createdAt)}
            {g.mode === 'compare' ? ' · compare' : ''}
            {g.provider ? ` · ${providerText(g, health?.imageProviders)}` : ''}
            {base ? ` · from “${base.title}”` : g.baseVariationId ? ' · from a deleted variation' : ''}
          </p>
        </div>
        <RunStatus g={g} />
      </div>

      {progress && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-2 text-xs" role="status" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
          <span className="flex-1 text-text">
            {progress.stage === 'planning' ? 'Planning the variations…' : `Rendering · ${progress.done} of ${progress.total} ready${progress.failed ? ` · ${progress.failed} failed` : ''}`}
          </span>
          <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={() => cancelRun(g.id)}>
            Cancel
          </Button>
        </div>
      )}

      {g.error && !progress && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {g.error}
        </p>
      )}

      {g.plan && <p className="text-xs leading-relaxed text-muted">{g.plan}</p>}

      {(variations.length > 0 || pending > 0) && (
        <div className="grid grid-cols-3 gap-1.5">
          {variations.map((v) => (
            <Thumb key={v.id} v={v} photoId={photo.id} active={viewing === v.id} caption={g.mode === 'compare' ? v.optionLabel : undefined} />
          ))}
          {Array.from({ length: favoritesOnly ? 0 : pending }, (_, i) => (
            <div key={`pending-${i}`} className="flex aspect-[4/3] items-center justify-center rounded-lg bg-surface-2" aria-label="Rendering">
              <Loader2 className="size-4 animate-spin text-subtle" aria-hidden />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Disclosure open={showBrief} onToggle={() => setShowBrief(!showBrief)} label="Brief" />
        {notes.length > 0 && (
          <Disclosure
            open={showPlants}
            onToggle={() => setShowPlants(!showPlants)}
            label={`Plant check · ${notes.length}${flagged ? ` (${flagged} flagged)` : ''}`}
            tone={flagged ? 'warning' : undefined}
          />
        )}
      </div>
      {showBrief && <BriefDetails g={g} scene={scene} />}
      {showPlants && <PlantTable notes={notes} />}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        {(g.mode === 'compare' || g.variations.length > 1) && (
          <Button size="sm" className="max-lg:h-9" variant="ghost" icon={<LayoutGrid className="size-3.5" />} onClick={() => openRunGrid(g.id)}>
            Side by side
          </Button>
        )}
        <Button
          size="sm"
          className="max-lg:h-9"
          variant="ghost"
          icon={<RotateCcw className="size-3.5" />}
          loading={starting}
          disabled={!!blocker || !!progress}
          title={blocker ?? 'Run the same brief again'}
          onClick={async () => {
            setStarting(true);
            try {
              await rerunGeneration(photo.id, g.id);
            } finally {
              setStarting(false);
            }
          }}
        >
          Re-run
        </Button>
        <Button size="sm" className="max-lg:h-9" variant="ghost" icon={<Copy className="size-3.5" />} title="Load this run's brief into the Design tab to change it" onClick={() => restoreBrief(photo.id, g.id)}>
          Edit brief
        </Button>
        <span className="flex-1" />
        <IconButton label="Delete run" size="sm" className="max-lg:size-9" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this run?"
        message={
          g.variations.length
            ? `Its ${g.variations.length} variation${g.variations.length === 1 ? '' : 's'}${g.variations.some((v) => v.favorite) ? ' (including favorites)' : ''} will be deleted. This can't be undone.`
            : "This run will be removed. This can't be undone."
        }
        confirmLabel="Delete run"
        onConfirm={() => {
          if (progress) cancelRun(g.id);
          void useStore.getState().deleteGeneration(photo.id, g.id);
        }}
      />
    </li>
  );
}

function RunStatus({ g }: { g: Generation }) {
  if (g.status === 'failed') return <Badge tone="danger">Failed</Badge>;
  if (g.status === 'partial') return <Badge tone="warning">Partial</Badge>;
  return null;
}

/** "OpenAI gpt-image-1" from the configured providers, else the stored id. */
function providerText(g: Generation, providers: { id: string; name: string }[] | undefined): string {
  if (!g.provider) return '';
  const name = providers?.find((p) => p.id === g.provider)?.name ?? (g.provider === 'openai' ? 'OpenAI' : g.provider === 'gemini' ? 'Gemini' : g.provider);
  return g.model ? `${name} ${g.model}` : name;
}

function Disclosure({ open, onToggle, label, tone }: { open: boolean; onToggle: () => void; label: string; tone?: 'warning' }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn('text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent', tone === 'warning' ? 'text-warning' : 'text-accent')}
    >
      {open ? '▾' : '▸'} {label}
    </button>
  );
}

function Thumb({ v, photoId, active, caption }: { v: Variation; photoId: string; active: boolean; caption?: string }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border bg-surface-2', active ? 'border-accent ring-2 ring-accent/40' : 'border-line')}>
      <button type="button" onClick={() => viewVariation(v.id)} className="block w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" title={v.title}>
        <span className="block aspect-[4/3] w-full">
          <BlobImage imageId={v.thumbId} alt={v.title} />
        </span>
        {caption && <span className="block truncate px-1.5 py-1 text-left text-[10.5px] font-medium text-text">{caption}</span>}
      </button>
      <button
        type="button"
        aria-pressed={v.favorite}
        aria-label={v.favorite ? `Unfavorite ${v.title}` : `Favorite ${v.title}`}
        onClick={() => useStore.getState().toggleFavorite(photoId, v.id)}
        className={cn(
          'absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/40 text-white transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white',
          v.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 max-lg:opacity-100',
        )}
      >
        <Star className={cn('size-3.5', v.favorite && 'fill-gold text-gold')} aria-hidden />
      </button>
    </div>
  );
}

function BriefDetails({ g, scene }: { g: Generation; scene: SceneMap | undefined }) {
  const s = summarizeBrief(g.brief, scene);
  return (
    <dl className="flex flex-col gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs">
      {s.prompt && (
        <div>
          <dt className="font-medium text-muted">Prompt</dt>
          <dd className="whitespace-pre-line text-text">{s.prompt}</dd>
        </div>
      )}
      {s.elements.length > 0 && (
        <div>
          <dt className="font-medium text-muted">Elements</dt>
          <dd>
            <ul className="mt-0.5 flex flex-col gap-1">
              {s.elements.map((el) => (
                <li key={el.id} className="text-text">
                  <span className="font-medium">{el.label}</span>
                  {el.choices.length > 0 && <span className="text-muted"> — {el.choices.join(', ')}</span>}
                  {el.where.length > 0 && <span className="text-subtle"> · {el.where.join(', ')}</span>}
                  {el.note && <span className="block text-muted">“{el.note}”</span>}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      {s.areas.length > 0 && (
        <div>
          <dt className="font-medium text-muted">Areas</dt>
          <dd className="text-text">{s.areas.join(', ')}</dd>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>{s.scope}</span>
        <span>Plants: {s.maturity.toLowerCase()}</span>
      </div>
    </dl>
  );
}

function PlantTable({ notes }: { notes: PlantNote[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Plants used in this run and how well they suit your site</caption>
        <thead className="bg-surface-2 text-[11px] text-muted">
          <tr>
            <th scope="col" className="px-2.5 py-1.5 font-medium">
              Plant
            </th>
            <th scope="col" className="px-2.5 py-1.5 font-medium">
              Fit
            </th>
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => (
            <tr key={`${n.name}${n.botanical ?? ''}`} className="border-t border-line align-top">
              <td className="px-2.5 py-2">
                <p className="font-medium text-text">{n.name}</p>
                {n.botanical && <p className="italic text-subtle">{n.botanical}</p>}
                {n.notes.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                    {n.notes.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
                {n.alternative && n.rating !== 'good' && (
                  <p className="mt-1 text-text">
                    <span className="font-medium">Better here:</span> {n.alternative}
                  </p>
                )}
              </td>
              <td className="px-2.5 py-2">
                <FeasibilityBadge feasibility={{ rating: n.rating, reasons: n.notes }} compact />
                <span className="sr-only">{FEASIBILITY_META[n.rating].label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
