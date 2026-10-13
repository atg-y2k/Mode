/**
 * The right-hand panel of the workspace. Studio mode: Design, Scene, Ideas,
 * Suggestions, History (store.studio.panel). Fine-tune mode: Surfaces, Paint,
 * Materials, Lighting, Library (store.panel).
 * Desktop: fixed-width content + a vertical icon/label tab rail on the outer
 * edge (clicking the active tab collapses the content to give the photo more
 * room). Mobile: a horizontal tab strip above the panel, full screen.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import {
  Blocks,
  BrickWall,
  History,
  Lamp,
  Lightbulb,
  Loader2,
  PaintRoller,
  PanelRightClose,
  PanelRightOpen,
  ScanSearch,
  Shapes,
  Sparkles,
  Sprout,
  type LucideIcon,
} from 'lucide-react';
import { LibraryPanel } from '../panels/LibraryPanel';
import { LightingPanel } from '../panels/LightingPanel';
import { MaterialsPanel } from '../panels/MaterialsPanel';
import { PaintPanel } from '../panels/PaintPanel';
import { SurfacesPanel } from '../panels/SurfacesPanel';
import { DesignPanel } from '../studio/panels/DesignPanel';
import { HistoryPanel } from '../studio/panels/HistoryPanel';
import { IdeasPanel } from '../studio/panels/IdeasPanel';
import { ScenePanel } from '../studio/panels/ScenePanel';
import { SuggestionsPanel } from '../studio/panels/SuggestionsPanel';
import {
  selectActiveDesign,
  selectActivePhoto,
  useStore,
  type PanelId,
  type StudioPanelId,
} from '../../state/store';
import { cn } from '../common';
import { ErrorBoundary } from './ErrorBoundary';
import { useSceneJob } from './sceneJobs';
import { setPanelCollapsed, useShellUI } from './shellUI';

type BadgeSpec = { kind: 'count'; n: number } | { kind: 'busy'; label: string } | null;

interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Longer name for tooltips / screen readers. */
  title: string;
  icon: LucideIcon;
  Panel: () => ReactNode;
  useBadge?: () => BadgeSpec;
}

const countBadge = (n: number | undefined): BadgeSpec => (n ? { kind: 'count', n } : null);

function useRunningOnActivePhoto(): boolean {
  return useStore((s) => {
    const photo = selectActivePhoto(s);
    if (!photo) return false;
    return photo.generations.some((g) => !!s.runs[g.id]);
  });
}

export const STUDIO_TABS: TabDef<StudioPanelId>[] = [
  {
    id: 'design',
    label: 'Design',
    title: 'Design brief — compose your idea from design elements',
    icon: Blocks,
    Panel: DesignPanel,
    useBadge: () => countBadge(useStore((s) => selectActivePhoto(s)?.draft?.elements.length)),
  },
  {
    id: 'scene',
    label: 'Scene',
    title: 'Scene map — areas, paths and architecture of this photo',
    icon: ScanSearch,
    Panel: ScenePanel,
    useBadge: () => {
      const job = useSceneJob(useStore((s) => s.selection.photoId));
      return job ? { kind: 'busy', label: 'Mapping the scene' } : null;
    },
  },
  {
    id: 'ideas',
    label: 'Ideas',
    title: 'Idea board — inspiration, themes and real products',
    icon: Lightbulb,
    Panel: IdeasPanel,
    useBadge: () => countBadge(useStore((s) => s.project?.ideaBoard.length)),
  },
  {
    id: 'suggestions',
    label: 'Suggest',
    title: 'Suggestions — AI ideas for this photo',
    icon: Sparkles,
    Panel: SuggestionsPanel,
    useBadge: () => countBadge(useStore((s) => selectActivePhoto(s)?.recommendations?.items.length)),
  },
  {
    id: 'history',
    label: 'History',
    title: 'History — every run, favorites and plant notes',
    icon: History,
    Panel: HistoryPanel,
    useBadge: () => {
      const running = useRunningOnActivePhoto();
      const n = useStore((s) => selectActivePhoto(s)?.generations.length);
      return running ? { kind: 'busy', label: 'Generating' } : countBadge(n);
    },
  },
];

export const FINETUNE_TABS: TabDef<PanelId>[] = [
  {
    id: 'surfaces',
    label: 'Surfaces',
    title: 'Surfaces — outline walls, floors, siding, lawn…',
    icon: Shapes,
    Panel: SurfacesPanel,
    useBadge: () => countBadge(useStore((s) => selectActivePhoto(s)?.regions.length)),
  },
  { id: 'paint', label: 'Paint', title: 'Paint colors', icon: PaintRoller, Panel: PaintPanel },
  { id: 'materials', label: 'Materials', title: 'Materials — flooring, tile, siding, pavers…', icon: BrickWall, Panel: MaterialsPanel },
  {
    id: 'lighting',
    label: 'Lighting',
    title: 'Lighting — time of day and fixtures',
    icon: Lamp,
    Panel: LightingPanel,
    useBadge: () => countBadge(useStore((s) => selectActiveDesign(s)?.lights.length)),
  },
  { id: 'library', label: 'Library', title: 'Plants & objects', icon: Sprout, Panel: LibraryPanel },
];

/** Current tab list + active id for the workspace mode. */
function useTabs(): { tabs: TabDef<string>[]; active: string; select: (id: string) => void } {
  const mode = useStore((s) => s.mode);
  const studioPanel = useStore((s) => s.studio.panel);
  const panel = useStore((s) => s.panel);
  if (mode === 'studio') {
    return {
      tabs: STUDIO_TABS as TabDef<string>[],
      active: studioPanel,
      select: (id) => useStore.getState().setStudio({ panel: id as StudioPanelId }),
    };
  }
  return {
    tabs: FINETUNE_TABS as TabDef<string>[],
    active: panel,
    select: (id) => useStore.getState().setPanel(id as PanelId),
  };
}

function Badge({ spec, compact }: { spec: BadgeSpec; compact?: boolean }) {
  if (!spec) return null;
  if (spec.kind === 'busy') {
    return (
      <span className={cn('absolute flex items-center justify-center rounded-full bg-surface', compact ? '-right-2 -top-1.5 size-3.5' : '-right-2.5 -top-2 size-4')}>
        <Loader2 className={cn('animate-spin text-accent', compact ? 'size-3' : 'size-3.5')} aria-label={spec.label} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'absolute flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-semibold leading-none text-accent-fg tabular-nums',
        compact ? '-right-2.5 -top-1.5 h-3.5 text-[9px]' : '-right-3 -top-2 h-4 text-[10px]',
      )}
    >
      {spec.n > 99 ? '99+' : spec.n}
    </span>
  );
}

function TabButton({
  tab,
  selected,
  orientation,
  onSelect,
}: {
  tab: TabDef<string>;
  selected: boolean;
  orientation: 'vertical' | 'horizontal';
  onSelect: () => void;
}) {
  const badge = tab.useBadge?.() ?? null;
  const Icon = tab.icon;
  const vertical = orientation === 'vertical';
  return (
    <button
      type="button"
      role="tab"
      id={`panel-tab-${tab.id}`}
      aria-selected={selected}
      aria-controls="workspace-panel"
      tabIndex={selected ? 0 : -1}
      title={tab.title}
      data-tab={tab.id}
      onClick={onSelect}
      className={cn(
        'relative flex shrink-0 items-center rounded-xl font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        vertical ? 'w-full flex-col gap-1 px-1 py-2.5 text-[10.5px]' : 'min-w-14 flex-1 flex-col justify-center gap-1 px-1 py-1.5 text-[11px]',
        selected ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
      )}
    >
      {vertical && selected && <span className="absolute inset-y-2 right-0 w-0.5 rounded-full bg-accent" aria-hidden />}
      <span className="relative">
        <Icon className={vertical ? 'size-5' : 'size-[18px]'} aria-hidden />
        <Badge spec={badge} compact={!vertical} />
      </span>
      <span className="leading-tight">{tab.label}</span>
    </button>
  );
}

function onTabListKey(e: KeyboardEvent<HTMLDivElement>, tabs: TabDef<string>[], active: string, select: (id: string) => void, vertical: boolean) {
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  const i = tabs.findIndex((t) => t.id === active);
  let next = -1;
  if (e.key === prevKey) next = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === nextKey) next = (i + 1) % tabs.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = tabs.length - 1;
  if (next < 0) return;
  e.preventDefault();
  select(tabs[next].id);
  e.currentTarget.querySelector<HTMLElement>(`[data-tab="${tabs[next].id}"]`)?.focus();
}

function PanelBody({ tab }: { tab: TabDef<string> | undefined }) {
  const mode = useStore((s) => s.mode);
  const photoId = useStore((s) => s.selection.photoId);
  if (!tab) return null;
  const { Panel } = tab;
  return (
    <div id="workspace-panel" role="tabpanel" aria-labelledby={`panel-tab-${tab.id}`} className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-surface">
      <ErrorBoundary area={`The ${tab.label} panel`} resetKey={`${mode}:${tab.id}:${photoId}`}>
        <Panel key={`${mode}:${tab.id}`} />
      </ErrorBoundary>
    </div>
  );
}

/** Desktop: content + vertical tab rail on the right edge. */
export function DesktopRightPanel() {
  const { tabs, active, select } = useTabs();
  const collapsed = useShellUI((s) => s.panelCollapsed);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <aside className="flex h-full min-h-0 shrink-0 border-l border-line bg-surface" aria-label="Design panels">
      {!collapsed && (
        <div className="flex min-h-0 w-[20rem] flex-col border-r border-line xl:w-[22rem]">
          <PanelBody tab={tab} />
        </div>
      )}
      <div className="flex w-[4.5rem] shrink-0 flex-col items-stretch gap-1 px-1.5 py-2">
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Panels"
          className="flex flex-col gap-1"
          onKeyDown={(e) => onTabListKey(e, tabs, tab.id, select, true)}
        >
          {tabs.map((t) => (
            <TabButton
              key={t.id}
              tab={t}
              selected={t.id === tab.id && !collapsed}
              orientation="vertical"
              onSelect={() => {
                if (t.id === tab.id) setPanelCollapsed(!collapsed);
                else {
                  select(t.id);
                  if (collapsed) setPanelCollapsed(false);
                }
              }}
            />
          ))}
        </div>
        <div className="mt-auto flex justify-center pb-1">
          <button
            type="button"
            onClick={() => setPanelCollapsed(!collapsed)}
            aria-label={collapsed ? 'Show panel' : 'Hide panel'}
            title={collapsed ? 'Show panel' : 'Hide panel (more room for the photo)'}
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            {collapsed ? <PanelRightOpen className="size-4.5" /> : <PanelRightClose className="size-4.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Mobile: horizontal tabs on top, panel below, full screen. */
export function MobileRightPanel() {
  const { tabs, active, select } = useTabs();
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-label="Design panels">
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label="Panels"
        className="scroll-thin flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1"
        onKeyDown={(e) => onTabListKey(e, tabs, tab.id, select, false)}
      >
        {tabs.map((t) => (
          <TabButton key={t.id} tab={t} selected={t.id === tab.id} orientation="horizontal" onSelect={() => select(t.id)} />
        ))}
      </div>
      <PanelBody tab={tab} />
    </section>
  );
}
