/**
 * Review step before every run (both render modes): Claude's plan, each
 * variation's exact instruction (editable, can be left out), the marked
 * preview (what may change / what you'll paste), what stays protected, and
 * for hand-offs how many pastes this costs. Send continues the run; Edit
 * brief or closing cancels it. Mounted once by the Workspace (every pane).
 */
import { ImagePlus, Info, Loader2, Pencil, Send, ShieldCheck, Sparkles, TriangleAlert, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CONTEXT_ZONE_KINDS, type Generation, type HandoffApp, type Photo } from '../../../../shared/types';
import type { PreparedHandoff } from '../../../handoff';
import { findPhoto, findVariation, useStore } from '../../../state/store';
import { Button, Modal, cn } from '../../common';
import { PlantNoteChips } from '../Feasibility';
import { cancelRun } from '../generate';
import { briefTargetIds, footprintRoom, growChoice, growthSources, sceneForRun } from '../maskFromZones';
import { AppIcon, TargetPreview } from './bits';
import { countToday, useHandoffLog, usageHint } from './log';
import { currentReferences, packPrompt, preparedExport } from './pack';
import { pasteImage } from './prefs';
import { appLabel } from './planned';
import { Callout } from '../panels/ui';
import {
  declineReview,
  handoffFooter,
  identicalInstructions,
  registerReviewHost,
  startingFromText,
  submitReview,
  TEMPLATE_PLAN_NOTE,
  useReview,
  type ReviewItem,
  type ReviewRequest,
} from './review';

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** The marked export for the review's "What you'll paste" tab (also warms the cache for the companion). */
function useMarkedExport(photo: Photo | undefined, g: Generation | undefined, app: HandoffApp, enabled: boolean) {
  const [state, setState] = useState<{ prepared: PreparedHandoff | null; error: string | null }>({ prepared: null, error: null });
  useEffect(() => {
    if (!enabled || !photo || !g) return;
    let alive = true;
    setState({ prepared: null, error: null });
    preparedExport(photo, g, app)
      .then((p) => alive && setState({ prepared: p, error: null }))
      .catch((err: Error) => alive && setState({ prepared: null, error: err.message || 'Could not prepare the export.' }));
    return () => {
      alive = false;
    };
    // The run's brief and starting image are fixed once it started: re-run only for another run or app.
  }, [enabled, photo?.id, g?.id, app]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/**
 * What the run may change and what stays, in words — from the run's own
 * target (frozen when it started), so a re-mapped scene can't relabel it.
 * `room`: ground beside a wider / curvier element that may change too;
 * `clipped`: such a choice found no ground beside it (it will be cut back).
 */
function protectedLabels(photo: Photo, g: Generation): { zones: string[]; keep: string[]; whole: boolean; room: string[]; clipped: boolean } {
  const scene = sceneForRun(photo.scene, g);
  const { zoneIds, pathIds } = briefTargetIds(g.brief, scene);
  const whole = g.brief.scope === 'whole' || zoneIds.length + pathIds.length === 0;
  const targeted = new Set(zoneIds);
  // The live room only for runs from before targets were frozen. With no room, `fr.empty` tells "no ground beside it" (clipped) from "already picked".
  const fr = g.target?.room ? null : footprintRoom(scene, g.brief, photo);
  const roomZones = g.target ? (g.target.room?.zones ?? []) : (fr?.room?.zones ?? []);
  const roomIds = new Set(roomZones.map((z) => z.id));
  const zones = (scene?.zones ?? []).filter((z) => !targeted.has(z.id) && !roomIds.has(z.id) && !CONTEXT_ZONE_KINDS.includes(z.kind)).map((z) => z.label);
  // Elements that grow from somewhere: their own "Where", else a walk / drive / patio picked on the photo.
  const growing = scene
    ? g.brief.elements.filter((e) => {
        if (!growChoice(e)) return false;
        const s = growthSources(e, g.brief, scene);
        return s.zoneIds.length + s.pathIds.length > 0;
      })
    : [];
  const noun = ({ pathway: 'walk', driveway: 'drive', patio: 'patio' } as Record<string, string>)[growing[0]?.type ?? ''] ?? 'area';
  const room = [...new Set(roomZones.map((z) => `${z.kind === 'lawn' ? 'Lawn' : z.label || 'Ground'} beside the ${noun}`))];
  const grows = !whole && growing.length > 0;
  return { zones: [...new Set(zones)], keep: scene?.keep ?? [], whole, room, clipped: grows && roomZones.length === 0 && fr?.empty === true };
}

export function ReviewModal() {
  const review = useReview((s) => s.current);
  useEffect(() => registerReviewHost(), []);
  return review ? <ReviewDialog key={review.generationId} review={review} /> : null;
}

function ReviewDialog({ review }: { review: ReviewRequest }) {
  const photo = useStore((s) => findPhoto(s.project, review.photoId)?.photo);
  const g = photo?.generations.find((x) => x.id === review.generationId);
  const aiEnabled = useStore((s) => s.health?.ai.enabled);
  const log = useHandoffLog();
  const hand = review.renderMode === 'handoff';
  const app = review.app;
  const [items, setItems] = useState<ReviewItem[]>(review.items ?? []);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'paste' | 'target'>(hand ? 'paste' : 'target');
  const marked = useMarkedExport(photo, g, app, hand);
  const markedUrl = useObjectUrl(marked.prepared?.marked ?? null);

  // The plan arrives after the dialog opened.
  useEffect(() => {
    if (review.items) setItems(review.items);
  }, [review.items]);

  const ready = review.stage === 'ready';
  const kept = items.filter((i) => !left.has(i.key));
  const id = review.generationId;
  // A compare whose instructions came out the same would give look-alike options: say so, and don't send them.
  const sameText = review.runMode === 'compare' && identicalInstructions(kept);

  const cancel = () => {
    declineReview(id);
    cancelRun(id);
  };
  const editBrief = () => {
    cancel();
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Describe the change"]')?.focus());
  };
  const send = () => {
    if (!ready || kept.length === 0 || sameText) return;
    submitReview(id, kept);
  };

  const prot = useMemo(() => (photo && g ? protectedLabels(photo, g) : null), [photo, g]);
  const today = countToday(log, app);
  const hint = usageHint(app, today);
  const n = ready ? kept.length : review.count;

  const title = hand ? `Review before handing off to ${appLabel(app)}` : 'Review before rendering';
  const sendLabel = hand ? (n === 1 ? `Send to ${appLabel(app)}` : `Send ${n} to ${appLabel(app)}`) : `Render ${n} variation${n === 1 ? '' : 's'}`;

  if (!photo || !g) return null;
  return (
    <Modal
      open
      onClose={cancel}
      size="xl"
      title={title}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={editBrief} title="Close and change the brief">
            Edit brief
          </Button>
          <span className="min-w-0 flex-1 text-xs text-muted max-sm:hidden">
            {hand ? handoffFooter(n) : 'Nothing is sent to the image API until you press Render.'}
          </span>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="max-sm:w-full"
            icon={hand ? <Send className="size-4" /> : <Sparkles className="size-4" />}
            onClick={send}
            disabled={!ready || kept.length === 0 || sameText}
          >
            {sendLabel}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* What changes / what you'll paste / what stays */}
        <div className="flex min-w-0 flex-col gap-3">
          {hand && (
            <div role="tablist" aria-label="Preview" className="inline-flex self-start rounded-lg bg-surface-2 p-0.5 text-xs">
              {(
                [
                  ['paste', 'What you’ll paste'],
                  ['target', 'What may change'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={cn('h-7 rounded-md px-2.5 font-medium transition-colors', tab === value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {hand && tab === 'paste' && markedUrl ? (
            <div className="relative grid place-items-center overflow-hidden rounded-xl bg-stage">
              <img src={markedUrl} alt={`The marked photo you'll paste into ${appLabel(app)}`} className="max-h-[22rem] w-full object-contain" />
              {marked.prepared && (
                <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                  {marked.prepared.mode === 'crop' ? 'Close-up of the area' : 'Whole photo'} · {marked.prepared.ratio} · camera data & location removed
                </span>
              )}
            </div>
          ) : hand && tab === 'paste' ? (
            // While the exact export is prepared, show what may change (same outline, full photo).
            <TargetPreview photo={photo} generation={g} baseVariationId={g.baseVariationId} className="w-full">
              {!marked.error && (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white">
                  <Loader2 className="size-3 animate-spin" /> Preparing the exact image you’ll paste…
                </span>
              )}
            </TargetPreview>
          ) : (
            <TargetPreview photo={photo} generation={g} baseVariationId={g.baseVariationId} className="w-full" />
          )}
          {prot && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2/60 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                <ShieldCheck className="size-4 text-success" />
                {prot.whole ? 'Whole image — anything may change' : 'Stays exactly as photographed'}
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {prot.whole
                  ? 'No areas are picked, so the whole photo may be reinterpreted. Pick areas on the photo to protect the rest.'
                  : hand
                    ? `Only the outlined area changes. When the image comes back, Mode lines it up and puts back every pixel outside the outline from your photo — even if ${appLabel(app)} changed it.`
                    : 'Only the outlined area changes; every pixel outside it is kept from your photo.'}
              </p>
              {!prot.whole && prot.room.length > 0 && (
                <p className="text-xs leading-relaxed text-text">
                  <span className="font-semibold">May also change:</span> {prot.room.join(', ').toLowerCase()} — room for the wider or curvier shape you chose.
                </p>
              )}
              {!prot.whole && prot.clipped && (
                <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-xs leading-relaxed text-text" role="note">
                  <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
                  <span>
                    The new shape is wider or curvier than the area that may change. Anything outside it will be put back from your photo.{' '}
                    <button type="button" onClick={editBrief} className="font-semibold text-accent hover:underline">
                      Edit brief
                    </button>
                  </span>
                </p>
              )}
              {!prot.whole && (prot.zones.length > 0 || prot.keep.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {[...prot.zones, ...prot.keep].slice(0, 14).map((label) => (
                    <span key={label} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Plan + instructions */}
        <div className="flex min-w-0 flex-col gap-3">
          {!ready ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-text">
                <Loader2 className="size-4 animate-spin text-accent" />
                {aiEnabled === false
                  ? `Writing ${review.count} instruction${review.count === 1 ? '' : 's'} from your brief…`
                  : `Claude is planning ${review.count} variation${review.count === 1 ? '' : 's'}…`}
              </div>
              {Array.from({ length: Math.min(review.count, 4) }, (_, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface-3" />
                  <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {review.plan && (
                <div className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">The plan</div>
                  <p className="text-sm leading-relaxed text-text">{review.plan}</p>
                </div>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <ImagePlus className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0">{startingFromText(g.baseVariationId ? findVariation(photo, g.baseVariationId) : undefined)}</span>
              </p>
              {review.planSource === 'template' && (
                // Claude is optional: plain information, not a warning.
                <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{TEMPLATE_PLAN_NOTE}</span>
                </p>
              )}
              {review.plantNotes && review.plantNotes.length > 0 && <PlantNoteChips notes={review.plantNotes} max={8} />}
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {hand ? `What ${appLabel(app)} will be asked` : 'What the image model will be asked'}
                </div>
                {hand && (
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <AppIcon app={app} /> {hint ?? `First hand-off to ${appLabel(app)} today`}
                  </span>
                )}
              </div>
              {sameText && (
                <Callout tone="warning" icon={<TriangleAlert className="size-4" aria-hidden />}>
                  These instructions are identical — the options would not differ.
                </Callout>
              )}
              <ol className="flex flex-col gap-2">
                {items.map((item, i) => {
                  const out = left.has(item.key);
                  return (
                    <li key={item.key} className={cn('rounded-xl border p-3 transition-colors', out ? 'border-dashed border-line bg-surface-2/40' : 'border-line bg-surface')}>
                      <div className="flex items-center gap-2">
                        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', out ? 'bg-surface-3 text-subtle' : 'bg-accent text-accent-fg')}>{i + 1}</span>
                        <input
                          value={item.title}
                          disabled={out}
                          aria-label={`Title of variation ${i + 1}`}
                          onChange={(e) => setItems((list) => list.map((x) => (x.key === item.key ? { ...x, title: e.target.value } : x)))}
                          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-semibold text-text focus:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:text-subtle disabled:line-through"
                        />
                        {item.optionLabel && item.optionLabel !== item.title && (
                          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">{item.optionLabel}</span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setLeft((s) => {
                              const next = new Set(s);
                              if (out) next.delete(item.key);
                              else next.add(item.key);
                              return next;
                            })
                          }
                          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
                          title={out ? 'Include it again' : 'Leave this variation out'}
                          aria-label={out ? `Include variation ${i + 1} again` : `Leave variation ${i + 1} out`}
                        >
                          {out ? <Undo2 className="size-3.5" /> : <X className="size-3.5" />}
                          {out && 'Undo'}
                        </button>
                      </div>
                      {!out && (
                        <textarea
                          value={item.brief}
                          aria-label={`Instruction for variation ${i + 1}`}
                          onChange={(e) => setItems((list) => list.map((x) => (x.key === item.key ? { ...x, brief: e.target.value } : x)))}
                          className="field-sizing-content mt-1.5 max-h-48 min-h-14 w-full resize-none rounded-lg border border-transparent bg-surface-2 px-2.5 py-2 text-[13px] leading-relaxed text-text focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      )}
                      {!out && hand && marked.prepared && (
                        <details className="group mt-1.5 text-[11px] text-muted">
                          <summary className="cursor-pointer select-none hover:text-text">Exact prompt for {appLabel(app)}</summary>
                          <p className="mt-1 max-h-48 overflow-y-auto rounded-lg bg-surface-2 p-2 leading-relaxed whitespace-pre-wrap text-text">
                            {packPrompt(photo, g, { brief: item.brief }, app, marked.prepared, {
                              references: currentReferences(g, app).map((r) => r.role),
                              unmarked: pasteImage() === 'clean',
                            })}
                          </p>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
              {hand && (
                <p className="text-xs leading-relaxed text-muted">
                  Mode wraps each instruction in {appLabel(app)}’s own editing phrasing (keep list, same framing and light, marker removal) — open
                  “Exact prompt” to read what you’ll paste.
                  {review.runMode === 'compare' && ' Each option starts from the same photo in its own new chat — never from another option’s result.'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
