/**
 * Compare mode switch (off / slider / side by side) and the press-and-hold
 * "Original" button.
 */
import { ChevronsLeftRight, Columns2, Eye, Square } from 'lucide-react';
import { useEffect } from 'react';
import { useStore, type ViewState } from '../../state/store';
import { Segmented, cn } from '../common';

const OPTIONS: { value: ViewState['compare']; label: string; icon: typeof Square }[] = [
  { value: 'off', label: 'Design only', icon: Square },
  { value: 'slider', label: 'Before / after slider', icon: ChevronsLeftRight },
  { value: 'split', label: 'Side by side', icon: Columns2 },
];

export function CompareControls() {
  const compare = useStore((s) => s.view.compare);
  return (
    <Segmented
      size="sm"
      value={compare}
      onChange={(v) => useStore.getState().setView({ compare: v, showOriginal: false })}
      options={OPTIONS.map((o) => ({
        value: o.value,
        title: o.label,
        label: (
          <>
            <o.icon className="size-4" aria-hidden />
            <span className="sr-only">{o.label}</span>
          </>
        ),
      }))}
    />
  );
}

export function HoldOriginalButton() {
  const showing = useStore((s) => s.view.showOriginal);
  const set = (v: boolean) => {
    if (useStore.getState().view.showOriginal !== v) useStore.getState().setView({ showOriginal: v });
  };

  // Never leave the original stuck on if the button unmounts mid-press.
  useEffect(() => () => set(false), []);

  return (
    <button
      type="button"
      aria-pressed={showing}
      aria-label="Hold to see the original photo"
      title="Hold to see the original photo"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          set(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') set(false);
      }}
      onBlur={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'inline-flex h-8 shrink-0 select-none items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors [-webkit-touch-callout:none]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        showing ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-text hover:bg-surface-3',
      )}
    >
      <Eye className="size-4" aria-hidden />
      <span className="hidden sm:inline">Original</span>
    </button>
  );
}
