/**
 * Toast stack (bottom-center) for store.notify(). Sits above the mobile bottom
 * navigation; errors are announced assertively, the rest politely.
 */
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useStore, type Toast } from '../../state/store';
import { cn } from '../common';

const ICONS = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
} as const;

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const inProject = useStore((s) => !!s.project);
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
        // Clear the mobile bottom nav inside a project.
        inProject ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6' : 'bottom-[calc(1.25rem+env(safe-area-inset-bottom))]',
      )}
    >
      <div aria-live="polite" aria-atomic="false" className="flex w-full flex-col items-center gap-2">
        {toasts
          .filter((t) => t.kind !== 'error')
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex w-full flex-col items-center gap-2">
        {toasts
          .filter((t) => t.kind === 'error')
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
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
