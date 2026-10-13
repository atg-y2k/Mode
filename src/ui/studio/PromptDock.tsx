/**
 * The prompt bar under the viewer — the Studio's core loop in one place:
 * target areas (chips from the photo) → describe it or add design elements →
 * Generate → compare (grid / strip) → refine. Bound to the photo's draft
 * brief; scope, strictness, variation count and how runs render (hand-off to
 * the user's ChatGPT / Gemini app, or an image API when the server has one)
 * sit next to Generate.
 */
import { Blocks, Check, ImagePlus, Inbox, Lightbulb, MessageCircle, MousePointerClick, Plus, Sparkle, Sparkles, Target, X } from 'lucide-react';
import { useMemo, useRef, type ReactNode } from 'react';
import { emptyBrief, type DesignBrief, type Photo, type Space } from '../../../shared/types';
import { findVariation, useStore } from '../../state/store';
import { cn } from '../common';
import { openElement, runOrNotify, viewVariation } from './actions';
import { generationBlocker } from './generate';
import { setDefaultHandoffApp } from './handoff/actions';
import { usePendingHandoffs } from './handoff/hooks';
import { appLabel } from './handoff/planned';
import { effectiveRenderMode, hasImageProviders } from './handoff/prefs';
import { setHandoffSession } from './handoff/session';
import { briefTargetIds } from './maskFromZones';
import { NO_IDEAS } from './panels/briefOps';
import { ideasForBrief } from './planRequest';

type Strictness = NonNullable<DesignBrief['strictness']>;

const STRICTNESS: [Strictness, string, string][] = [
  ['strict', 'Strict', 'Only the requested change, exactly — nothing else is touched'],
  ['balanced', 'Balanced', 'The requested change, with sensible details to make it look built'],
  ['creative', 'Creative', 'May refine and embellish details within the picked areas'],
];

/** Small segmented control in the dock's settings row. */
function DockSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 rounded-lg bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const COUNTS = [1, 2, 3, 4, 5, 6];

function Chip({
  icon,
  children,
  onRemove,
  onClick,
  tone = 'neutral',
  title,
}: {
  icon: ReactNode;
  children: ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  tone?: 'neutral' | 'accent' | 'base';
  title?: string;
}) {
  const tones = {
    neutral: 'bg-surface-2 text-text border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    base: 'bg-gold/12 text-text border-gold/40',
  };
  return (
    <span
      className={cn('inline-flex h-7 max-w-56 shrink-0 items-center gap-1 rounded-full border pl-2 text-xs font-medium', tones[tone], !onRemove && 'pr-2.5')}
      title={title}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      {onClick ? (
        <button type="button" onClick={onClick} className="min-w-0 truncate hover:underline focus-visible:underline focus-visible:outline-none">
          {children}
        </button>
      ) : (
        <span className="min-w-0 truncate">{children}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-full opacity-60 hover:bg-black/10 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-accent"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

function Step({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', done ? 'text-accent' : 'text-muted')}>
      <span
        className={cn('grid size-4.5 place-items-center rounded-full text-[10px] font-semibold', done ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-muted')}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function PromptDock({ photo, space }: { photo: Photo; space: Space | undefined }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const studio = useStore((s) => s.studio);
  const health = useStore((s) => s.health);
  const board = useStore((s) => s.project?.ideaBoard);
  const location = useStore((s) => s.project?.location);
  const brief = photo.draft ?? emptyBrief();
  const scene = photo.scene;
  const base = findVariation(photo, studio.viewVariationId);
  const renderMode = effectiveRenderMode(studio, health);
  const hand = renderMode === 'handoff';
  const blocker = generationBlocker({ health, studio }, renderMode);
  const providers = health?.imageProviders ?? [];
  const apiAvailable = hasImageProviders(health);
  const pending = usePendingHandoffs();
  const waitingHere = pending.filter((p) => p.photoId === photo.id && p.planned.status === 'awaiting-handoff').length;
  const backHere = pending.filter((p) => p.photoId === photo.id && p.planned.status === 'staged').length;

  const zoneById = useMemo(() => new Map((scene?.zones ?? []).map((z) => [z.id, z])), [scene?.zones]);
  const ideas = useMemo(() => ideasForBrief(board ?? [], brief, space?.id ?? null), [board, brief, space?.id]);
  const targets = briefTargetIds(brief, scene);
  const hasTargets = targets.zoneIds.length + targets.pathIds.length > 0;
  const described = brief.prompt.trim().length > 0 || brief.elements.length > 0;
  const exterior = (space?.kind ?? 'exterior') === 'exterior';
  const plantElements = brief.elements.some((e) => e.type === 'planting-bed' || e.type === 'trees-shrubs' || e.type === 'lawn' || e.type === 'border-edging');
  const climateKnown = !!(location?.climate || location?.hardinessZone);

  const setPrompt = (prompt: string) => useStore.getState().updateDraft(photo.id, (d) => void (d.prompt = prompt), { coalesce: `draft-prompt:${photo.id}` });
  const removeTarget = (zoneId: string) =>
    useStore.getState().updateDraft(
      photo.id,
      (d) => {
        d.targetZoneIds = d.targetZoneIds.filter((id) => id !== zoneId);
      },
      {},
    );
  const removeElement = (elementId: string) => {
    useStore.getState().updateDraft(
      photo.id,
      (d) => {
        d.elements = d.elements.filter((e) => e.id !== elementId);
      },
      {},
    );
    if (studio.activeElementId === elementId) useStore.getState().setStudio({ activeElementId: null });
  };
  const removeIdea = (ideaId: string) =>
    useStore.getState().updateDraft(
      photo.id,
      (d) => {
        const next = ideas.map((i) => i.id).filter((id) => id !== ideaId);
        // An empty list means "use the active ideas": excluding the last one needs the marker.
        d.ideaItemIds = next.length > 0 ? next : [NO_IDEAS];
      },
      {},
    );
  const openDesign = () => {
    const s = useStore.getState();
    s.setStudio({ panel: 'design', activeElementId: null });
    if (!window.matchMedia?.('(min-width: 64rem)').matches) s.setView({ mobilePane: 'panel' });
  };
  const generate = () => void runOrNotify({ photoId: photo.id, mode: 'variations' });

  const canGenerate = !blocker && described;
  let hint: { tone: 'muted' | 'warning' | 'danger'; text: string } | null = null;
  if (blocker) hint = { tone: 'danger', text: blocker };
  else if (described && brief.scope === 'zones' && !hasTargets)
    hint = { tone: 'warning', text: 'No areas picked yet, so the whole image may change. Click areas on the photo, or choose Whole image.' };
  else if (exterior && plantElements && !climateKnown)
    hint = { tone: 'muted', text: 'Add your ZIP code in Settings so plant choices are checked against your hardiness zone and climate.' };
  else if (health && !health.ai.enabled)
    hint = { tone: 'muted', text: 'AI planning is off on this server — each variation follows a simple template of your brief.' };
  else if (hand && described && pending.length === 0)
    hint = {
      tone: 'muted',
      text: `Mode plans each variation and prepares the photo + prompt; you paste them into ${appLabel(studio.handoffApp)} and bring the images back.`,
    };

  const emptyBrief_ = !described && brief.targetZoneIds.length === 0 && ideas.length === 0;

  const generateButton = (
    <button
      type="button"
      onClick={generate}
      disabled={!canGenerate}
      title={
        canGenerate
          ? hand
            ? `Plan the variations and prepare them for ${appLabel(studio.handoffApp)} (Ctrl/⌘ + Enter)`
            : 'Generate (Ctrl/⌘ + Enter)'
          : (blocker ?? 'Describe the change or add an element first')
      }
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45"
    >
      <Sparkles className="size-4" />
      Generate
      <span className="hidden @md:inline">{studio.variationCount > 1 ? ` ${studio.variationCount}` : ''}</span>
    </button>
  );

  return (
    <div className="@container border-t border-line bg-surface px-3 pt-2.5 pb-3 sm:px-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        {/* Brief at a glance */}
        <div className="flex items-center gap-1.5">
          <div className="scroll-thin -mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
            {base && (
              <Chip
                icon={<ImagePlus className="size-3.5" />}
                tone="base"
                onRemove={() => viewVariation(null)}
                title="New runs start from the variation you're viewing — remove to start from the original"
              >
                From: {base.title}
              </Chip>
            )}
            {emptyBrief_ ? (
              <div className="flex min-w-0 items-center gap-2.5 py-0.5">
                <Step n={1} done={hasTargets}>
                  Pick areas<span className="hidden @2xl:inline"> on the photo</span>
                </Step>
                <Step n={2} done={described}>
                  Describe<span className="hidden @xl:inline"> or add elements</span>
                </Step>
                <Step n={3} done={photo.generations.length > 0}>
                  Generate
                </Step>
                <Step n={4} done={photo.generations.some((g) => g.variations.some((v) => v.favorite))}>
                  Compare<span className="hidden @lg:inline"> &amp; refine</span>
                </Step>
              </div>
            ) : (
              <>
                {brief.targetZoneIds.map((id) => {
                  const z = zoneById.get(id);
                  return z ? (
                    <Chip key={id} icon={<Target className="size-3.5" />} tone="accent" onRemove={() => removeTarget(id)} title={z.description || z.label}>
                      {z.label}
                    </Chip>
                  ) : null;
                })}
                {brief.elements.map((el) => {
                  const where = [
                    ...el.zoneIds.map((id) => zoneById.get(id)?.label),
                    ...el.pathIds.map((id) => scene?.paths.find((p) => p.id === id)?.label),
                  ].filter(Boolean);
                  return (
                    <Chip
                      key={el.id}
                      icon={<Blocks className="size-3.5" />}
                      onClick={() => openElement(el.id)}
                      onRemove={() => removeElement(el.id)}
                      title={where.length ? `${el.label} — ${where.join(', ')}` : `${el.label} — pick where it goes`}
                    >
                      {el.label}
                      {where.length > 0 && <span className="font-normal text-muted"> · {where.length === 1 ? where[0] : `${where.length} areas`}</span>}
                    </Chip>
                  );
                })}
                {ideas.map((i) => (
                  <Chip key={i.id} icon={<Lightbulb className="size-3.5" />} onRemove={() => removeIdea(i.id)} title={i.aiDescription || i.note || i.title}>
                    {i.title}
                  </Chip>
                ))}
              </>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1 pl-1">
            {scene && !hasTargets && !emptyBrief_ && (
              <button
                type="button"
                onClick={() => {
                  useStore.getState().setStudio({ showZones: true, sketch: 'none' });
                  useStore.getState().notify('Click the areas on the photo that may change.', 'info');
                }}
                className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text"
              >
                <MousePointerClick className="size-3.5" /> Pick areas
              </button>
            )}
            <button
              type="button"
              onClick={openDesign}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-xs font-medium text-text hover:border-accent hover:text-accent"
            >
              <Plus className="size-3.5" /> Element
            </button>
          </span>
        </div>

        {/* Prompt + Generate */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textRef}
            value={brief.prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canGenerate) generate();
              }
            }}
            rows={1}
            aria-label="Describe the change"
            placeholder={
              exterior
                ? 'Describe the change — e.g. “a 5 ft curved flagstone path to the door, lavender along the edge, warm path lights”'
                : 'Describe the change — e.g. “warm white walls, oak floors and a linen sofa, soft evening light”'
            }
            className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-text placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          {generateButton}
        </div>

        {/* Run settings + guidance */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <DockSegmented
            label="How variations are rendered"
            value={hand ? studio.handoffApp : 'api'}
            onChange={(v) => {
              if (v === 'api') useStore.getState().setStudio({ renderMode: 'api' });
              else setDefaultHandoffApp(v);
            }}
            options={[
              {
                value: 'chatgpt' as const,
                label: (
                  <>
                    <MessageCircle className="size-3.5" />
                    <span>ChatGPT</span>
                  </>
                ),
                title: 'Hand off to your ChatGPT app: Mode prepares the photo and prompt, you paste them and bring the image back (uses your subscription)',
              },
              {
                value: 'gemini' as const,
                label: (
                  <>
                    <Sparkle className="size-3.5" />
                    <span>Gemini</span>
                  </>
                ),
                title: 'Hand off to your Gemini app: Mode prepares the photo and prompt, you paste them and bring the image back (uses your subscription)',
              },
              ...(apiAvailable
                ? [{ value: 'api' as const, label: <span>API</span>, title: 'Render automatically with the image API key configured on the server' }]
                : []),
            ]}
          />
          <DockSegmented
            label="How closely to follow the brief"
            value={brief.strictness ?? 'balanced'}
            onChange={(v) =>
              useStore.getState().updateDraft(
                photo.id,
                (d) => {
                  if (v === 'balanced') delete d.strictness;
                  else d.strictness = v;
                },
                {},
              )
            }
            options={STRICTNESS.map(([value, label, title]) => ({ value, label, title }))}
          />
          <div role="radiogroup" aria-label="What may change" className="inline-flex h-8 rounded-lg bg-surface-2 p-0.5 text-xs">
            {(
              [
                ['zones', 'Only selected areas', 'Only the areas and paths in the brief change; everything else stays exactly as photographed'],
                ['whole', 'Whole image', 'Anything in the photo may change'],
              ] as const
            ).map(([value, label, title]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={brief.scope === value}
                title={title}
                onClick={() => useStore.getState().updateDraft(photo.id, (d) => void (d.scope = value), {})}
                className={cn(
                  'rounded-md px-2.5 font-medium whitespace-nowrap transition-colors',
                  brief.scope === value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="inline-flex h-8 items-center rounded-lg bg-surface-2 px-1.5 text-xs" title="Variations per run">
            <span className="sr-only">Variations per run</span>
            <select
              value={studio.variationCount}
              onChange={(e) => useStore.getState().setStudio({ variationCount: Number(e.target.value) })}
              className="h-7 cursor-pointer rounded-md bg-transparent text-xs font-medium text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              {COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} variation{n === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
          {!hand && providers.length > 1 && (
            <label className="inline-flex h-8 items-center rounded-lg bg-surface-2 px-1.5 text-xs" title="Image provider for the next run">
              <span className="sr-only">Image provider</span>
              <select
                value={studio.provider ?? ''}
                onChange={(e) => {
                  const provider = (e.target.value || null) as typeof studio.provider;
                  useStore.getState().setStudio({ provider });
                  try {
                    if (provider) localStorage.setItem('mode.provider', provider);
                    else localStorage.removeItem('mode.provider');
                  } catch {
                    // storage blocked: the choice still applies to this session
                  }
                }}
                className="h-7 cursor-pointer rounded-md bg-transparent text-xs font-medium text-text focus:outline-none"
              >
                <option value="">{providers.find((p) => p.isDefault)?.name ?? providers[0].name} (default)</option>
                {providers
                  .filter((p) => !p.isDefault)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {waitingHere + backHere > 0 && (
            <button
              type="button"
              onClick={() => setHandoffSession({ companion: 'open', staging: null })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 text-xs font-semibold text-accent hover:brightness-95"
              title="Open the hand-off card"
            >
              <Inbox className="size-3.5" />
              {waitingHere > 0 && `${waitingHere} hand-off${waitingHere === 1 ? '' : 's'} waiting`}
              {waitingHere > 0 && backHere > 0 && ' · '}
              {backHere > 0 && `${backHere} back`}
            </button>
          )}
          {hint && (
            <p
              className={cn(
                'min-w-48 flex-1 text-xs leading-snug',
                hint.tone === 'danger' ? 'text-danger' : hint.tone === 'warning' ? 'text-warning' : 'text-muted',
              )}
            >
              {hint.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
