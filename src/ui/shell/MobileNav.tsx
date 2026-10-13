/**
 * Phone / small tablet bottom navigation (< lg): one pane at a time —
 * Spaces, the photo (Studio viewer or Fine-tune canvas), and the panels.
 * Small spinners show background work (scene mapping, generating).
 */
import type { ReactNode } from 'react';
import { FolderOpen, Image as ImageIcon, Loader2, PanelRight } from 'lucide-react';
import { useStore, type ViewState } from '../../state/store';
import { cn } from '../common';
import { useSceneJobs } from './sceneJobs';

type Pane = ViewState['mobilePane'];

export function MobileNav() {
  const pane = useStore((s) => s.view.mobilePane);
  const mode = useStore((s) => s.mode);
  const generating = useStore((s) => Object.keys(s.runs).length > 0);
  const mapping = useSceneJobs((s) => Object.keys(s.jobs).length > 0);
  const panelLabel = mode === 'studio' ? 'Design' : 'Tools';

  const items: { id: Pane; label: string; icon: ReactNode; busy?: string }[] = [
    { id: 'spaces', label: 'Spaces', icon: <FolderOpen className="size-5" aria-hidden />, busy: mapping ? 'Mapping a scene' : undefined },
    { id: 'editor', label: 'Photo', icon: <ImageIcon className="size-5" aria-hidden />, busy: generating ? 'Generating variations' : undefined },
    { id: 'panel', label: panelLabel, icon: <PanelRight className="size-5" aria-hidden /> },
  ];

  return (
    <nav aria-label="Workspace" className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-3">
        {items.map((it) => {
          const active = pane === it.id;
          return (
            <li key={it.id} className="flex">
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => useStore.getState().setView({ mobilePane: it.id })}
                className={cn(
                  'relative m-1 flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  active ? 'text-accent' : 'text-muted active:bg-surface-2',
                )}
              >
                <span className={cn('relative flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-accent-soft')}>
                  {it.icon}
                  {it.busy && (
                    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-surface">
                      <Loader2 className="size-3.5 animate-spin text-accent" aria-label={it.busy} />
                    </span>
                  )}
                </span>
                {it.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
