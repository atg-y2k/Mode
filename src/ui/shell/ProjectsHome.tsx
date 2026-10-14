/**
 * Projects home: a warm editorial landing (hero with an interactive
 * before/after, "how it works" in four steps, what you can redesign inside
 * and out) and the recent projects grid (cover, counts, last edit; rename /
 * delete). Import a project backup from here too.
 */
import { useCallback, useRef, useState } from 'react';
import {
  ArrowRight,
  Blocks,
  Camera,
  FolderInput,
  GalleryHorizontal,
  House,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  ScanSearch,
  Settings,
  ShieldCheck,
  Trash2,
  Trees,
  Sofa,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectMeta } from '../../../shared/types';
import * as db from '../../state/persistence';
import { useStore } from '../../state/store';
import { Button, ConfirmModal, Field, IconButton, Modal, TextInput, cn } from '../common';
import { AiStatusPill, aiLevel, aiSummary } from './AiStatus';
import { errorText, plural, relativeTime } from './format';
import { HeroIllustration } from './HeroIllustration';
import { useBlobUrl } from './hooks';
import { Logo } from './Logo';
import { Menu } from './Menu';
import { openNewProject, openSettings } from './shellUI';

export function ProjectsHome() {
  const ready = useStore((s) => s.ready);
  const projects = useStore((s) => s.projects);
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const hasProjects = sorted.length > 0;

  return (
    <div className="min-h-dvh bg-bg">
      <HomeHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-14 px-4 pb-16 sm:px-6 lg:gap-20">
        <Hero compact={hasProjects} />
        {hasProjects || !ready ? (
          <>
            <ProjectsSection projects={sorted} loading={!ready} />
            <HowItWorks />
          </>
        ) : (
          <>
            <HowItWorks />
            <FirstProjectCallout />
          </>
        )}
        <RedesignScope />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-accent" aria-hidden />
            Projects and photos are stored in this browser. Nothing is uploaded unless you run an AI feature.
          </p>
          <p>Move a project to another device with Export → Back up project.</p>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function useImportProject() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        try {
          await useStore.getState().importProject(file);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { input, busy, pick: () => inputRef.current?.click() };
}

function HomeHeader() {
  const imp = useImportProject();
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <Logo />
      <div className="flex items-center gap-1.5 sm:gap-2">
        <AiStatusPill />
        <Button variant="ghost" size="sm" icon={<FolderInput className="size-4" />} loading={imp.busy} onClick={imp.pick} title="Import a project backup (.json)">
          <span className="hidden sm:inline">Import</span>
        </Button>
        <IconButton label="Settings" onClick={() => openSettings('appearance')}>
          <Settings className="size-4.5" />
        </IconButton>
        {imp.input}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ compact }: { compact: boolean }) {
  const imp = useImportProject();
  const level = useStore((s) => aiLevel(s.health));
  return (
    <section className={cn('grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14', compact ? 'pt-2 lg:pt-6' : 'pt-4 lg:pt-12')}>
      <div className="flex flex-col gap-5 motion-safe:animate-[mode-rise-in_400ms_ease-out]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Home redesign studio</p>
        <h1 className="font-display text-[2.4rem] leading-[1.05] tracking-tight text-text sm:text-5xl lg:text-[3.6rem]">
          See your home redesigned before you lift a shovel.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          Upload a photo of a room, the front of your house or the backyard. Mode maps what’s there and renders photoreal takes on new
          paint, materials, lighting and landscaping — side by side, so you can decide with confidence.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={openNewProject}>
            Start a project
          </Button>
          <Button variant="ghost" size="lg" icon={<FolderInput className="size-5" />} loading={imp.busy} onClick={imp.pick}>
            Import a backup
          </Button>
          {imp.input}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden /> Photos stay on this device
          </span>
          <span>Inside and out</span>
          <span>Hand tools work offline</span>
        </p>
        {(level === 'off' || level === 'offline') && (
          <p className="max-w-xl rounded-xl border border-line bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            {aiSummary(level)}{' '}
            <button type="button" onClick={() => openSettings('server')} className="font-medium text-accent underline-offset-2 hover:underline">
              {level === 'off' ? 'How to add one' : 'Check the server'}
            </button>
          </p>
        )}
      </div>
      <HeroIllustration className="mx-auto w-full max-w-xl motion-safe:animate-[mode-fade-in_600ms_ease-out]" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Camera,
    title: 'Upload a photo',
    body: 'Any room, the front of the house, the yard. Daylight and a straight-on view work best.',
  },
  {
    icon: ScanSearch,
    title: 'Mode maps the scene',
    body: 'It finds the facade, door, walkway, lawn and beds — or walls, floor and cabinets — and reads the architecture.',
  },
  {
    icon: Blocks,
    title: 'Compose your idea',
    body: 'Add design elements — paint · materials · lighting · landscaping — and pick options from visual swatches.',
  },
  {
    icon: GalleryHorizontal,
    title: 'Compare variations',
    body: 'See photoreal takes side by side, refine the one you love, or fine-tune colors and plants by hand.',
  },
];

function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h2 id="how-it-works" className="font-display text-2xl text-text sm:text-3xl">
          How it works
        </h2>
        <p className="text-sm text-muted">Four steps from a phone photo to a plan you can act on.</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-panel">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <step.icon className="size-5" aria-hidden />
              </span>
              <span className="font-display text-2xl text-line-strong" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <h3 className="font-medium text-text">
              <span className="sr-only">Step {i + 1}: </span>
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted">{step.body}</p>
            {i < STEPS.length - 1 && (
              <ArrowRight className="absolute -right-3.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-bg p-0.5 text-subtle lg:block" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const SCOPE: { title: string; icon: LucideIcon; items: string[] }[] = [
  {
    title: 'Inside',
    icon: Sofa,
    items: ['Wall paint', 'Accent walls', 'Flooring', 'Cabinets', 'Countertops', 'Backsplash', 'Lighting', 'Furniture & decor', 'Window treatments'],
  },
  {
    title: 'Outside',
    icon: Trees,
    items: ['Exterior paint', 'Front door', 'Roof & trim', 'Pathways', 'Border edging', 'Planting beds', 'Trees & shrubs', 'Lawn', 'Patio', 'Outdoor lighting'],
  },
];

function RedesignScope() {
  return (
    <section aria-labelledby="what-you-can-redesign" className="grid gap-4 rounded-3xl border border-line bg-surface-2/60 p-5 sm:p-8 lg:grid-cols-[0.8fr_1fr_1fr] lg:gap-8">
      <div className="flex flex-col gap-2">
        <h2 id="what-you-can-redesign" className="font-display text-2xl text-text">
          Inside and out
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Rooms and landscapes are equally at home in Mode. Outdoor plant ideas are checked against your hardiness zone, sun and space.
        </p>
      </div>
      {SCOPE.map((g) => (
        <div key={g.title} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <g.icon className="size-4 text-accent" aria-hidden />
            {g.title}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {g.items.map((it) => (
              <li key={it} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-text">
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function FirstProjectCallout() {
  return (
    <section className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <House className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-2xl text-text">Your projects will live here</h2>
        <p className="max-w-md text-sm text-muted">Start with one photo — the front of the house is a great first try.</p>
      </div>
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={openNewProject}>
        Start a project
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Projects grid
// ---------------------------------------------------------------------------

function ProjectsSection({ projects, loading }: { projects: ProjectMeta[]; loading: boolean }) {
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState<ProjectMeta | null>(null);
  // Stable callbacks: Modal re-runs its focus effect when onClose changes identity.
  const closeRename = useCallback(() => setRenaming(null), []);
  const closeDelete = useCallback(() => setDeleting(null), []);
  return (
    <section aria-labelledby="your-projects" className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="your-projects" className="font-display text-2xl text-text sm:text-3xl">
            Your projects
          </h2>
          {!loading && <p className="text-sm text-muted">{plural(projects.length, 'project')} on this device</p>}
        </div>
        <div className="hidden sm:block">
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={openNewProject}>
            New project
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }, (_, i) => <ProjectSkeleton key={i} />)
        ) : (
          <>
            <NewProjectTile />
            {projects.map((p) => (
              <ProjectCard key={p.id} meta={p} onRename={() => setRenaming(p)} onDelete={() => setDeleting(p)} />
            ))}
          </>
        )}
      </div>
      {renaming && <RenameProjectModal meta={renaming} onClose={closeRename} />}
      <ConfirmModal
        open={!!deleting}
        title="Delete project?"
        message={
          <>
            <strong className="text-text">“{deleting?.name}”</strong> and all its photos, scene maps, variations and designs will be removed
            from this device. This can’t be undone — back it up first if you might want it later.
          </>
        }
        confirmLabel="Delete project"
        onClose={closeDelete}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          void useStore
            .getState()
            .deleteProject(target.id)
            .then(
              () => useStore.getState().notify(`Deleted “${target.name}”.`, 'info'),
              (err: unknown) => useStore.getState().notify(`Couldn't delete the project: ${errorText(err)}`, 'error'),
            );
        }}
      />
    </section>
  );
}

function NewProjectTile() {
  return (
    <button
      type="button"
      onClick={openNewProject}
      className="group flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-strong p-6 text-center text-muted transition-colors hover:border-accent hover:bg-accent-soft/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-accent shadow-panel transition-transform group-hover:scale-105">
        <Plus className="size-6" aria-hidden />
      </span>
      <span className="font-medium text-text">New project</span>
      <span className="text-xs">Start from a photo of a room or your yard</span>
    </button>
  );
}

function ProjectCard({ meta, onRename, onDelete }: { meta: ProjectMeta; onRename: () => void; onDelete: () => void }) {
  const cover = useBlobUrl(meta.coverThumbId);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await useStore.getState().openProject(meta.id);
    } catch (err) {
      useStore.getState().notify(`Couldn't open the project: ${errorText(err)}`, 'error');
    } finally {
      setOpening(false);
    }
  };
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-panel transition-shadow hover:shadow-lg">
      <button
        type="button"
        onClick={() => void open()}
        aria-label={`Open ${meta.name}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {cover.status === 'ready' ? (
          <img src={cover.url} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" draggable={false} />
        ) : cover.status === 'loading' ? (
          <span className="block size-full animate-pulse bg-surface-3" />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 bg-linear-to-br from-accent-soft to-surface-2 text-accent">
            <House className="size-10 opacity-80" aria-hidden />
            <span className="text-xs text-muted">No photos yet</span>
          </span>
        )}
        {opening && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 className="size-6 animate-spin text-white" aria-hidden />
          </span>
        )}
      </button>
      <div className="flex items-start gap-2 p-4">
        <button type="button" onClick={() => void open()} className="min-w-0 flex-1 text-left focus-visible:outline-none" tabIndex={-1}>
          <h3 className="truncate font-display text-lg leading-tight text-text">{meta.name}</h3>
          <p className="mt-1 text-xs text-muted">
            {plural(meta.spaceCount, 'space')} · {plural(meta.photoCount, 'photo')}
          </p>
          <p className="mt-0.5 text-xs text-subtle">Edited {relativeTime(meta.updatedAt)}</p>
        </button>
        <Menu
          label={`More actions for ${meta.name}`}
          items={[
            { label: 'Open', icon: <ArrowRight className="size-4" />, onSelect: () => void open() },
            { label: 'Rename…', icon: <Pencil className="size-4" />, onSelect: onRename },
            { kind: 'separator' },
            { label: 'Delete…', icon: <Trash2 className="size-4" />, danger: true, onSelect: onDelete },
          ]}
          trigger={(props) => (
            <button
              {...props}
              type="button"
              className="-mr-1.5 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
            >
              <MoreHorizontal className="size-4.5" />
            </button>
          )}
        />
      </div>
    </article>
  );
}

function ProjectSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface" aria-hidden>
      <div className="aspect-[4/3] animate-pulse bg-surface-2" />
      <div className="flex flex-col gap-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
      </div>
    </div>
  );
}

/** Renames a project that isn't open (saved directly; the listing is updated in place). */
async function renameStoredProject(id: string, name: string): Promise<void> {
  const open = useStore.getState().project;
  if (open?.id === id) {
    useStore.getState().updateProjectInfo({ name });
    return;
  }
  const p = await db.loadProject(id);
  if (!p) throw new Error('Project not found');
  const next = { ...p, name, updatedAt: Date.now() };
  await db.saveProject(next);
  const meta = db.projectMeta(next);
  useStore.setState((s) => ({
    projects: s.projects.map((m) => (m.id === id ? meta : m)).sort((a, b) => b.updatedAt - a.updatedAt),
  }));
}

function RenameProjectModal({ meta, onClose }: { meta: ProjectMeta; onClose: () => void }) {
  const [name, setName] = useState(meta.name);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const save = async () => {
    if (!trimmed || busy) return;
    if (trimmed === meta.name) return onClose();
    setBusy(true);
    try {
      await renameStoredProject(meta.id, trimmed);
      onClose();
    } catch (err) {
      useStore.getState().notify(`Couldn't rename: ${errorText(err)}`, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Rename project"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!trimmed} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      </form>
    </Modal>
  );
}
