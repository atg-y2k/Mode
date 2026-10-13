/**
 * What you can do with a variation: More like this, Refine (feedback), Use as
 * base, Compare with original, Download, Delete. Offered as a menu on strip
 * tiles and grid cells, and inline on the viewer's info card.
 */
import { Columns2, Download, Ellipsis, ImagePlus, PenLine, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { Variation } from '../../../shared/types';
import { useStore } from '../../state/store';
import { Button, cn } from '../common';
import { downloadVariation, runOrNotify, viewVariation } from './actions';
import { Popover } from './Popover';
import { setStudioUI } from './ui';

export function moreLikeThis(photoId: string, v: Variation): void {
  void runOrNotify({ photoId, mode: 'variations', moreLikeThis: v.id });
}

export function startFromVariation(v: Variation): void {
  viewVariation(v.id);
  useStore.getState().notify(`Next runs start from “${v.title}”. Press Esc to go back to the original.`, 'info');
}

export function compareWithOriginal(v: Variation): void {
  viewVariation(v.id);
  setStudioUI({ slider: true, sliderPos: 0.5 });
}

export function askDelete(photoId: string, v: Variation): void {
  setStudioUI({ confirm: { kind: 'variation', photoId, id: v.id, title: v.title } });
}

const REFINE_IDEAS = ['Make it wider', 'Softer, more natural', 'Add lighting', 'Warmer palette', 'More plants'];

/** Feedback form for "Refine": the variation becomes the starting image and the feedback is applied to it. */
export function RefineForm({
  photoId,
  variation,
  onDone,
  tone = 'surface',
}: {
  photoId: string;
  variation: Variation;
  onDone: () => void;
  tone?: 'surface' | 'stage';
}) {
  const [text, setText] = useState('');
  const count = useStore((s) => s.studio.variationCount);
  const submit = () => {
    const feedback = text.trim();
    if (!feedback) return;
    void runOrNotify({ photoId, mode: 'variations', baseVariationId: variation.id, feedback, count: Math.min(count, 3) });
    onDone();
  };
  return (
    <form
      className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={cn('text-xs font-medium', tone === 'stage' ? 'text-white/80' : 'text-muted')}>Refine “{variation.title}”</div>
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="What should change? e.g. a wider path and lavender along the edge"
        className={cn(
          'w-full resize-none rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30',
          tone === 'stage' ? 'border-white/15 bg-white/10 text-white placeholder:text-white/45' : 'border-line bg-surface text-text placeholder:text-subtle',
        )}
      />
      <div className="flex flex-wrap gap-1">
        {REFINE_IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => setText((t) => (t.trim() ? `${t.trim().replace(/[.,;]$/, '')}, ${idea.toLowerCase()}` : idea))}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] transition-colors',
              tone === 'stage' ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-surface-2 text-muted hover:text-text',
            )}
          >
            {idea}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} className={tone === 'stage' ? 'text-white hover:bg-white/10' : undefined}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!text.trim()} icon={<WandSparkles className="size-3.5" />}>
          Refine
        </Button>
      </div>
    </form>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none',
        danger ? 'text-danger' : 'text-text',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-muted')}>{icon}</span>
      {children}
    </button>
  );
}

/** "…" button with every variation action (strip tiles, grid cells). */
export function VariationMenuButton({
  photoId,
  variation,
  className,
  tone = 'surface',
}: {
  photoId: string;
  variation: Variation;
  className?: string;
  tone?: 'surface' | 'stage';
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'closed' | 'menu' | 'refine'>('closed');
  const close = () => setMode('closed');
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={`Actions for ${variation.title}`}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={mode !== 'closed'}
        onClick={(e) => {
          e.stopPropagation();
          setMode((m) => (m === 'closed' ? 'menu' : 'closed'));
        }}
        className={cn(
          'grid size-7 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-accent',
          tone === 'stage' ? 'bg-black/45 text-white hover:bg-black/65' : 'bg-surface/90 text-text shadow-sm hover:bg-surface',
          className,
        )}
      >
        <Ellipsis className="size-4" />
      </button>
      <Popover anchor={ref.current} open={mode !== 'closed'} onClose={close} prefer="top" label="Variation actions">
        {mode === 'refine' ? (
          <RefineForm photoId={photoId} variation={variation} onDone={close} />
        ) : (
          <div role="menu" className="flex w-56 flex-col">
            <MenuItem icon={<Sparkles className="size-4" />} onClick={run(() => moreLikeThis(photoId, variation))}>
              More like this
            </MenuItem>
            <MenuItem icon={<PenLine className="size-4" />} onClick={() => setMode('refine')}>
              Refine…
            </MenuItem>
            <MenuItem icon={<ImagePlus className="size-4" />} onClick={run(() => startFromVariation(variation))}>
              Use as base
            </MenuItem>
            <MenuItem icon={<Columns2 className="size-4" />} onClick={run(() => compareWithOriginal(variation))}>
              Compare with original
            </MenuItem>
            <MenuItem icon={<Download className="size-4" />} onClick={run(() => void downloadVariation(variation))}>
              Download
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <MenuItem danger icon={<Trash2 className="size-4" />} onClick={run(() => askDelete(photoId, variation))}>
              Delete…
            </MenuItem>
          </div>
        )}
      </Popover>
    </>
  );
}
