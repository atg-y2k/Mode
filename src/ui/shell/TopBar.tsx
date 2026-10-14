/**
 * Workspace top bar (h-14): back to projects, editable project name, save
 * status, the Studio / Fine-tune mode switch, undo/redo, Export, Settings.
 * On phones it condenses to icons with the mode switch in the middle (the
 * project name moves to the Spaces pane).
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { useStore, type WorkspaceMode } from '../../state/store';
import { IconButton, Segmented, cn } from '../common';
import { ExportMenu } from './ExportMenu';
import { errorText, shortcutLabel } from './format';
import { useIsDesktop } from './hooks';
import { LogoMark } from './Logo';
import { openSettings, setSidebarCollapsed, useShellUI } from './shellUI';
import { IS_MAC } from './useHotkeys';

export function TopBar() {
  const desktop = useIsDesktop();
  const collapsed = useShellUI((s) => s.sidebarCollapsed);
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
      <BackButton />
      {desktop && (
        <IconButton
          label={collapsed ? 'Show spaces' : 'Hide spaces'}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen className="size-4.5" /> : <PanelLeftClose className="size-4.5" />}
        </IconButton>
      )}
      {desktop ? (
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ProjectName />
            <SaveStatus />
          </div>
          <ModeSwitch />
          <div className="flex items-center justify-end gap-1">
            <UndoRedo />
            <span className="mx-1.5 h-6 w-px bg-line" aria-hidden />
            <ExportMenu />
            <IconButton label="Settings" onClick={() => openSettings()}>
              <Settings className="size-4.5" />
            </IconButton>
          </div>
        </div>
      ) : (
        <>
          <ModeSwitch compact />
          <div className="ml-auto flex items-center">
            <UndoRedo />
            <ExportMenu compact />
            <IconButton label="Settings" onClick={() => openSettings()}>
              <Settings className="size-4.5" />
            </IconButton>
          </div>
        </>
      )}
    </header>
  );
}

function BackButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label="All projects"
      title="All projects"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await useStore.getState().closeProject();
        } catch (err) {
          useStore.getState().notify(`Couldn't close the project: ${errorText(err)}`, 'error');
          setBusy(false);
        }
      }}
      className="group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg pl-1.5 pr-2 text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowLeft className="size-4" aria-hidden />}
      <LogoMark className="hidden size-7 xl:block" />
    </button>
  );
}

/** Inline-editable project name (click or Enter to edit; Enter/blur saves; Escape cancels). */
export function ProjectName({ className, large }: { className?: string; large?: boolean }) {
  const name = useStore((s) => s.project?.name ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) useStore.getState().updateProjectInfo({ name: v });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={80}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(name);
            setEditing(false);
          }
        }}
        className={cn(
          'h-9 min-w-0 max-w-full rounded-lg border border-accent bg-surface px-2 font-display text-text focus:outline-none focus:ring-2 focus:ring-accent/25',
          large ? 'text-xl' : 'text-lg',
          className,
        )}
      />
    );
  }
  return (
    <button
      type="button"
      title="Rename project"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className={cn(
        'min-w-0 truncate rounded-lg px-2 py-1 text-left font-display leading-tight text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent',
        large ? 'text-xl' : 'text-lg',
        className,
      )}
    >
      {name || 'Untitled project'}
    </button>
  );
}

export function SaveStatus({ className }: { className?: string }) {
  const state = useStore((s) => s.saveState);
  const readOnly = useStore((s) => s.readOnly);
  const [showSaved, setShowSaved] = useState(false);
  // "Saved" fades to a quiet "Saved on this device" after a moment.
  useEffect(() => {
    if (state !== 'saved') return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(t);
  }, [state]);

  let content;
  if (readOnly) {
    content = (
      <span className="inline-flex items-center gap-1 text-warning">
        <CircleAlert className="size-3.5" aria-hidden /> Not saved here
      </span>
    );
  } else if (state === 'saving') {
    content = (
      <>
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
      </>
    );
  } else if (state === 'error') {
    content = (
      <span className="inline-flex items-center gap-1 text-danger">
        <CircleAlert className="size-3.5" aria-hidden /> Not saved
      </span>
    );
  } else {
    content = (
      <>
        <CircleCheck className={cn('size-3.5', showSaved && 'text-success')} aria-hidden />
        {showSaved ? 'Saved' : 'On this device'}
      </>
    );
  }
  const title = readOnly
    ? readOnly === 'stale'
      ? 'Another tab saved this project after this copy was opened. Changes made here are not saved.'
      : 'This project is open for editing in another tab. Changes made here are not saved.'
    : state === 'error'
      ? 'The last change could not be saved. Check storage space in Settings, then retry.'
      : 'Changes are saved automatically in this browser';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-subtle', className)}>
      <span role="status" title={title} className="inline-flex items-center gap-1">
        {content}
      </span>
      {state === 'error' && !readOnly && (
        <button
          type="button"
          onClick={() => void useStore.getState().retrySave()}
          className="rounded font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Retry
        </button>
      )}
    </span>
  );
}

function ModeSwitch({ compact }: { compact?: boolean }) {
  const mode = useStore((s) => s.mode);
  return (
    <Segmented<WorkspaceMode>
      value={mode}
      label="Workspace mode"
      size={compact ? 'sm' : 'md'}
      onChange={(m) => m !== mode && useStore.getState().setMode(m)}
      options={[
        {
          value: 'studio',
          title: 'Studio — describe an idea and compare photoreal variations',
          label: (
            <>
              {!compact && <Sparkles className="size-4" aria-hidden />}
              <span className="whitespace-nowrap">Studio</span>
            </>
          ),
        },
        {
          value: 'finetune',
          title: 'Fine-tune — precise hand tools: surfaces, paint, materials, lighting, plants',
          label: (
            <>
              {!compact && <SlidersHorizontal className="size-4" aria-hidden />}
              <span className="whitespace-nowrap">Fine-tune</span>
            </>
          ),
        },
      ]}
    />
  );
}

function UndoRedo() {
  const undoLabel = useStore((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useStore((s) => s.future[0]?.label);
  return (
    <>
      <IconButton
        label={undoLabel ? `Undo ${undoLabel.toLowerCase()} (${shortcutLabel('z', { mac: IS_MAC })})` : 'Undo'}
        disabled={!undoLabel}
        onClick={() => useStore.getState().undo()}
      >
        <Undo2 className="size-4.5" />
      </IconButton>
      <IconButton
        label={redoLabel ? `Redo ${redoLabel.toLowerCase()} (${shortcutLabel('z', { mac: IS_MAC, shift: true })})` : 'Redo'}
        disabled={!redoLabel}
        onClick={() => useStore.getState().redo()}
      >
        <Redo2 className="size-4.5" />
      </IconButton>
    </>
  );
}
