/**
 * History — every run on the photo as a branching tree (borrowed from
 * InvokeAI / Yardzen version trees): the original photo at the root, the
 * runs started from it, and under each run the runs started from one of its
 * variations. "Branch from here" makes a variation (or the original) the
 * starting image of the next run. Each run shows Claude's plan, its
 * variations with where they were made (ChatGPT / Gemini / API) and a
 * warning when a returned image didn't line up well, the hand-offs still
 * waiting, the brief, the plant feasibility notes, provider / model and
 * time. Runs can be re-run, their brief restored for editing, or deleted. A
 * favorites filter keeps the runs with starred variations (and the branch
 * leading to them).
 */
import { useMemo, useState } from 'react';
import {
  Copy,
  GitBranch,
  GitCompare,
  Hourglass,
  History,
  ImagePlus,
  Inbox,
  LayoutGrid,
  Loader2,
  MessageCircle,
  RotateCcw,
  Sparkle,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Generation, Photo, PlantNote, SceneMap, Variation } from '../../../../shared/types';
import { getElementDef } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { relativeTime } from '../../shell/format';
import { pickPhotos } from '../../shell/photoImport';
import { Badge, Button, ConfirmModal, EmptyState, IconButton, PanelHeader, Segmented, cn } from '../../common';
import { cancelRun, generationBlocker } from '../generate';
import { openHandoff } from '../handoff/actions';
import { openRunGrid, rerunGeneration, restoreBrief, viewVariation } from './actions';
import { summarizeBrief } from './briefOps';
import { useStudioContext } from './context';
import {
  branchCounts,
  buildRunTree,
  filterRunTree,
  firstPendingPlanned,
  handoffCounts,
  handoffText,
  hasFavorites,
  provenanceOf,
  requestOpenHandoff,
  type RunNode,
} from './historyTree';
import { BlobImage, FEASIBILITY_META, FeasibilityBadge } from './ui';

type Filter = 'all' | 'favorites';

/** Deeper branches stop indenting (the panel is narrow). */
const MAX_INDENT = 3;

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
  return <RunTree photo={photo} scene={scene} />;
}

/**
 * Opens the hand-off companion on a run: announces `mode:open-handoff` for
 * the hand-off UI; when no listener takes it over, opens the run's first
 * pending item directly.
 */
function openRunHandoff(photo: Photo, g: Generation): void {
  if (requestOpenHandoff(g.id)) return;
  const plannedId = firstPendingPlanned(g);
  if (plannedId) openHandoff({ photoId: photo.id, generationId: g.id, plannedId });
}

/** "Branch from here": shows a variation (null = the original photo), which makes it the starting image of the next run. */
function branchFrom(variation: Variation | null): void {
  viewVariation(variation?.id ?? null);
  useStore.getState().notify(variation ? `Next run starts from “${variation.title}”.` : 'Next run starts from the original photo.', 'info');
}

function RunTree({ photo, scene }: { photo: Photo; scene: SceneMap | undefined }) {
  const [filter, setFilter] = useState<Filter>('all');
  const favorites = useMemo(() => photo.generations.reduce((n, g) => n + g.variations.filter((v) => v.favorite).length, 0), [photo.generations]);
  const tree = useMemo(() => buildRunTree(photo.generations), [photo.generations]);
  const shown = useMemo(() => (filter === 'favorites' ? filterRunTree(tree, hasFavorites) : tree), [tree, filter]);
  const branches = useMemo(() => branchCounts(photo.generations), [photo.generations]);

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader title="History" subtitle="Every run on this photo, branching from the image it started from." />
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
          Compose a brief on the Design tab and generate — every run lands here so you can compare, re-run, branch from a favorite and pick keepers.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon={<Star className="size-6" />} title="No favorites yet">
          Star the variations you like (in the strip below the photo or here) to find them quickly.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4">
          <OriginalRow photo={photo} runs={tree.filter((n) => !n.baseMissing).length} />
          <Branch nodes={shown} depth={1} photo={photo} scene={scene} favoritesOnly={filter === 'favorites'} branches={branches} />
        </div>
      )}
    </div>
  );
}

/** The root of the tree: the photo as uploaded. */
function OriginalRow({ photo, runs }: { photo: Photo; runs: number }) {
  const viewing = useStore((s) => s.studio.viewVariationId);
  const active = viewing === null;
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border bg-surface p-2.5', active ? 'border-accent/50' : 'border-line')}>
      <button
        type="button"
        onClick={() => branchFrom(null)}
        title="View the original photo"
        className={cn('h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent', active && 'ring-2 ring-accent/40')}
      >
        <BlobImage imageId={photo.thumbId} alt="Original photo" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">Original photo</p>
        <p className="text-[11px] text-subtle">
          {runs} run{runs === 1 ? '' : 's'} start{runs === 1 ? 's' : ''} here
        </p>
      </div>
      {active ? (
        <Badge tone="accent">Next base</Badge>
      ) : (
        <Button size="sm" variant="ghost" className="max-lg:h-9" icon={<GitBranch className="size-3.5" />} onClick={() => branchFrom(null)}>
          Branch
        </Button>
      )}
    </div>
  );
}

function Branch({
  nodes,
  depth,
  photo,
  scene,
  favoritesOnly,
  branches,
}: {
  nodes: RunNode[];
  depth: number;
  photo: Photo;
  scene: SceneMap | undefined;
  favoritesOnly: boolean;
  branches: Map<string, number>;
}) {
  return (
    <ul className={cn('flex flex-col gap-3', depth <= MAX_INDENT && 'ml-2 border-l-2 border-line pl-2')} aria-label={depth === 1 ? 'Runs from the original photo' : undefined}>
      {nodes.map((n) => (
        <li key={n.run.id} className="flex min-w-0 flex-col gap-3">
          {n.context ? (
            <ContextRow node={n} />
          ) : (
            <RunCard node={n} photo={photo} scene={scene} favoritesOnly={favoritesOnly} branches={branches} />
          )}
          {n.children.length > 0 && (
            <Branch nodes={n.children} depth={depth + 1} photo={photo} scene={scene} favoritesOnly={favoritesOnly} branches={branches} />
          )}
        </li>
      ))}
    </ul>
  );
}

function runTitle(g: Generation): string {
  return compareLabel(g) ?? (g.variations[0]?.title || (g.brief.prompt.trim() ? g.brief.prompt.trim().split('\n')[0] : 'Variations'));
}

/** "from [thumb] Curved bluestone" — where a branched run started. */
function BaseLine({ node }: { node: RunNode }) {
  if (node.base) {
    return (
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-subtle">
        <GitBranch className="size-3 shrink-0" aria-hidden />
        <span className="shrink-0">from</span>
        <span className="size-4 shrink-0 overflow-hidden rounded">
          <BlobImage imageId={node.base.variation.thumbId} alt="" />
        </span>
        <span className="truncate text-muted">“{node.base.variation.title}”</span>
      </div>
    );
  }
  if (node.baseMissing) return <p className="text-[11px] text-subtle">Started from a variation that was deleted</p>;
  return null;
}

/** A run kept by the favorites filter only because a branch with favorites grows from it. */
function ContextRow({ node }: { node: RunNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-dashed border-line px-3 py-2">
      <BaseLine node={node} />
      <p className="truncate text-xs font-medium text-muted">{runTitle(node.run)}</p>
      <p className="text-[11px] text-subtle">No favorites in this run — it leads to the branch below.</p>
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

function RunCard({
  node,
  photo,
  scene,
  favoritesOnly,
  branches,
}: {
  node: RunNode;
  photo: Photo;
  scene: SceneMap | undefined;
  favoritesOnly: boolean;
  branches: Map<string, number>;
}) {
  const g = node.run;
  const progress = useStore((s) => s.runs[g.id]);
  const viewing = useStore((s) => s.studio.viewVariationId);
  const health = useStore((s) => s.health);
  const blocker = generationBlocker({ health });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showPlants, setShowPlants] = useState(false);
  const [starting, setStarting] = useState(false);
  const variations = favoritesOnly ? g.variations.filter((v) => v.favorite) : g.variations;
  const pending = progress ? Math.max(0, progress.total - progress.done - progress.failed) : 0;
  const hand = handoffCounts(g);
  const handText = handoffText(hand);
  const waitingTiles = favoritesOnly ? [] : (g.planned ?? []).filter((p) => p.status === 'awaiting-handoff' || p.status === 'staged');
  const viewed = variations.find((v) => v.id === viewing);
  const notes = g.plantNotes ?? [];
  const flagged = notes.filter((n) => n.rating !== 'good').length;
  const isHandoff = g.renderMode === 'handoff';
  const App = g.provider === 'Gemini' ? Sparkle : MessageCircle;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          {g.mode === 'compare' ? <GitCompare className="size-[18px]" aria-hidden /> : <Sparkles className="size-[18px]" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-text">{runTitle(g)}</p>
          <p className="mt-0.5 text-[11px] text-subtle" title={new Date(g.createdAt).toLocaleString()}>
            {relativeTime(g.createdAt)}
            {g.mode === 'compare' ? ' · compare' : ''}
            {g.provider ? ` · ${isHandoff ? `hand-off to ${g.provider}` : providerText(g, health?.imageProviders)}` : ''}
          </p>
          <BaseLine node={node} />
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

      {handText && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-accent/25 bg-accent-soft px-2.5 py-2 text-xs">
          <p className="flex items-start gap-1.5 text-text">
            <Hourglass className="mt-px size-3.5 shrink-0 text-accent" aria-hidden />
            {handText}
          </p>
          <Button size="sm" variant="primary" className="max-lg:h-9" icon={<App className="size-3.5" />} onClick={() => openRunHandoff(photo, g)}>
            {hand.waiting ? 'Continue hand-off' : 'Review results'}
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

      {(variations.length > 0 || pending > 0 || waitingTiles.length > 0) && (
        <div className="grid grid-cols-3 gap-1.5">
          {variations.map((v) => (
            <Thumb
              key={v.id}
              v={v}
              photo={photo}
              active={viewing === v.id}
              branches={branches.get(v.id) ?? 0}
              caption={g.mode === 'compare' ? v.optionLabel : undefined}
            />
          ))}
          {waitingTiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openRunHandoff(photo, g)}
              title={p.status === 'staged' ? `${p.title || 'Variation'} — back from the app, waiting for your review` : `${p.title || 'Variation'} — waiting for you to take it to ${g.provider || 'ChatGPT'}`}
              className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 px-1 text-center text-[10px] font-medium leading-tight text-accent transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
            >
              {p.status === 'staged' ? <Inbox className="size-4" aria-hidden /> : <Hourglass className="size-4" aria-hidden />}
              <span className="line-clamp-2">{p.status === 'staged' ? 'Back · review' : p.optionLabel || 'Waiting'}</span>
            </button>
          ))}
          {Array.from({ length: favoritesOnly || isHandoff ? 0 : pending }, (_, i) => (
            <div key={`pending-${i}`} className="flex aspect-[4/3] items-center justify-center rounded-lg bg-surface-2" aria-label="Rendering">
              <Loader2 className="size-4 animate-spin text-subtle" aria-hidden />
            </div>
          ))}
        </div>
      )}

      {viewed && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <GitBranch className="size-3 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Viewing “{viewed.title}” — the next run branches from it.
          </span>
          <button type="button" onClick={() => branchFrom(null)} className="shrink-0 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            Use original
          </button>
        </p>
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
            ? `Its ${g.variations.length} variation${g.variations.length === 1 ? '' : 's'}${g.variations.some((v) => v.favorite) ? ' (including favorites)' : ''} will be deleted${node.children.length ? '; runs that branched from them stay, starting from a deleted variation' : ''}. This can't be undone.`
            : "This run will be removed. This can't be undone."
        }
        confirmLabel="Delete run"
        onConfirm={() => {
          if (progress) cancelRun(g.id);
          void useStore.getState().deleteGeneration(photo.id, g.id);
        }}
      />
    </article>
  );
}

/** A variation: view it, star it, branch from it; where it was made and how it lined up. */
function Thumb({ v, photo, active, caption, branches }: { v: Variation; photo: Photo; active: boolean; caption?: string; branches: number }) {
  const prov = provenanceOf(v.source);
  return (
    <div className={cn('group relative min-w-0 overflow-hidden rounded-lg border bg-surface-2', active ? 'border-accent ring-2 ring-accent/40' : 'border-line')}>
      <button type="button" onClick={() => viewVariation(v.id)} className="block w-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" title={v.title}>
        <span className="block aspect-[4/3] w-full">
          <BlobImage imageId={v.thumbId} alt={v.title} />
        </span>
        {caption && <span className="block truncate px-1.5 py-1 text-left text-[10.5px] font-medium text-text">{caption}</span>}
      </button>
      {prov.label && (
        <span
          className={cn(
            'pointer-events-none absolute left-1 inline-flex h-4 max-w-[calc(100%-0.5rem)] items-center gap-0.5 rounded bg-black/55 px-1 text-[9px] font-semibold uppercase tracking-wide text-white',
            caption ? 'bottom-7' : 'bottom-1',
          )}
          title={prov.warning ? `${prov.label}: ${prov.warning}` : `Made with ${prov.label}`}
        >
          {prov.warn && <TriangleAlert className="size-2.5 shrink-0 text-gold" aria-hidden />}
          <span className="truncate">{prov.short}</span>
        </span>
      )}
      {prov.warn && <span className="sr-only">{`Alignment needs a look: ${prov.warning}`}</span>}
      <button
        type="button"
        aria-label={`Branch from ${v.title}${branches ? ` (${branches} run${branches === 1 ? '' : 's'} already started from it)` : ''}`}
        title={`Branch from here — the next run starts from this variation${branches ? `\n${branches} run${branches === 1 ? '' : 's'} already started from it` : ''}`}
        onClick={() => branchFrom(v)}
        className={cn(
          'absolute left-1 top-1 flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full bg-black/40 px-1.5 text-[10px] font-semibold text-white transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white',
          active || branches > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 max-lg:opacity-100',
        )}
      >
        <GitBranch className="size-3.5" aria-hidden />
        {branches > 0 && <span>{branches}</span>}
      </button>
      <button
        type="button"
        aria-pressed={v.favorite}
        aria-label={v.favorite ? `Unfavorite ${v.title}` : `Favorite ${v.title}`}
        onClick={() => useStore.getState().toggleFavorite(photo.id, v.id)}
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

function RunStatus({ g }: { g: Generation }) {
  if (g.status === 'awaiting') return <Badge tone="accent">Hand-off</Badge>;
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
