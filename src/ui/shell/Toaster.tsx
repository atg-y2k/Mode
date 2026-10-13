/**
 * Toast stack for store.notify(). Bottom-center, above the mobile bottom
 * navigation; inside a project on desktop it sits at the top edge instead, so
 * it never covers the prompt dock's controls (the next thing the user reaches
 * for). Errors are announced assertively, the rest politely. Also hosts the
 * "open in another tab" notice while the open project is read-only here.
 */
import { CircleAlert, CircleCheck, Info, Lock, X } from 'lucide-react';
import { useState } from 'react';
import { useStore, type Toast } from '../../state/store';
import { Button, cn } from '../common';

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
} as const;

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const inProject = useStore((s) => !!s.project);
  const readOnly = useStore((s) => (s.project ? s.readOnly : null));
  // Desktop, in a project: newest toast nearest the top edge.
  const stack = cn('flex w-full flex-col items-center gap-2', inProject && 'lg:flex-col-reverse');
  return (
    <div
      data-testid="toaster"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
        // In a project: above the mobile bottom nav; on desktop at the top, clear of the prompt dock.
        inProject ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-auto lg:top-2' : 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
      )}
    >
      {readOnly && <ReadOnlyNotice reason={readOnly} />}
      <div aria-live="polite" aria-atomic="false" className={stack}>
        {toasts
          .filter((t) => t.kind !== 'error')
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" className={stack}>
        {toasts
          .filter((t) => t.kind === 'error')
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
    </div>
  );
}

/** The open project is saved by another tab (or changed there): edits here are not saved until this tab takes over. */
function ReadOnlyNotice({ reason }: { reason: 'other-tab' | 'stale' }) {
  const [busy, setBusy] = useState(false);
  const takeOver = async () => {
    setBusy(true);
    try {
      await useStore.getState().takeOver();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-warning/40 bg-surface px-3.5 py-2.5 text-sm text-text shadow-panel"
    >
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 leading-snug">
        <p className="font-medium">{reason === 'stale' ? 'Changed in another tab' : 'Open in another tab'}</p>
        <p className="text-xs text-muted">
          {reason === 'stale'
            ? 'Another tab saved this project after it opened here. Changes made here since are not saved.'
            : 'That tab saves this project. Changes made here are not saved.'}
        </p>
      </div>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void takeOver()}>
        {reason === 'stale' ? 'Reload' : 'Take over'}
      </Button>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const Icon = ICONS[toast.kind];
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-text shadow-panel',
        'motion-safe:animate-[mode-toast-in_180ms_ease-out]',
        toast.kind === 'error' ? 'border-danger/40' : 'border-line',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-4 shrink-0',
          toast.kind === 'error' ? 'text-danger' : toast.kind === 'success' ? 'text-success' : 'text-accent',
        )}
      />
      <p className="min-w-0 flex-1 leading-snug break-words">{toast.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => useStore.getState().dismissToast(toast.id)}
        className="-mr-1 -mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
