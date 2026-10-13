/**
 * One design element of the brief (Pathway, Wall paint…): where it applies,
 * each choice dimension as a visual question with option swatches to compare
 * (plant options carry a feasibility badge), "Compare these on my photo" per
 * question, a note, and "Tailor to my photo" (AI options for this house).
 */
import { memo, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, GitCompare, Lightbulb, Route, ScanSearch, Sparkles, Trash2, X } from 'lucide-react';
import type { ElementDimension, ElementOption, ElementSpec, ProjectLocation, SceneMap, ZoneKind } from '../../../../shared/types';
import { feasibilityContext, getElementDef, guidanceFor, swatchSpanIn, withPlantFeasibility } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { useSceneJob } from '../../shell/sceneJobs';
import { Button, IconButton, TextInput, cn } from '../../common';
import { generationBlocker } from '../generate';
import { elementFeasibilityContext } from '../planRequest';
import { compareOptions, editBrief, mapScene, tailorElement, tailorJobKey, typeBrief } from './actions';
import { clearAiJob, useAiJob } from './aiJobs';
import { chooseOption, defaultCompareSelection, isChosen, moveElement, removeElement, toggleElementPath, toggleElementZone, worstChosenFeasibility } from './briefOps';
import { elementIcon } from './icons';
import { AiJobStatus, AiProgress, Callout, Chip, FEASIBILITY_META, FeasibilityBadge, InlineText, OptionVisualView, useAiReady } from './ui';
import { zonesForElement } from './zones';

export interface ElementCardProps {
  el: ElementSpec;
  photoId: string;
  scene: SceneMap | undefined;
  location: ProjectLocation | undefined;
  setting: 'interior' | 'exterior';
  expanded: boolean;
  /** The brief's target zones (their sun rates plants when the element has no zones of its own). */
  targetZoneIds: string[];
  index: number;
  count: number;
}

const MAX_COMPARE = 6;

export const ElementCard = memo(function ElementCard({ el, photoId, scene, location, setting, expanded, targetZoneIds, index, count }: ElementCardProps) {
  const bodyId = useId();
  const def = getElementDef(el.type);
  const Icon = elementIcon(def.icon);
  const ctx = useMemo(
    () => elementFeasibilityContext(el, scene, location, setting, { feasibilityContext }, targetZoneIds),
    [el, scene, location, setting, targetZoneIds],
  );
  const dims = useMemo(() => withPlantFeasibility(el.type, el.dimensions, ctx), [el.type, el.dimensions, ctx]);
  const worst = worstChosenFeasibility(el, dims);
  const summary = dims.flatMap((d) => d.options.filter((o) => isChosen(el, d.id, o.id)).map((o) => o.label)).join(' · ');
  const tailorJob = useAiJob(tailorJobKey(el.id));
  const setExpanded = (open: boolean) => useStore.getState().setStudio({ activeElementId: open ? el.id : null });

  return (
    <article
      data-element-id={el.id}
      className={cn('rounded-2xl border bg-surface transition-shadow', expanded ? 'border-accent/40 shadow-panel' : 'border-line hover:border-line-strong')}
    >
      <div className="flex items-center gap-1 p-2">
        {expanded ? (
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-1">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <InlineText
                value={el.label}
                label="Rename element"
                className="max-w-full text-sm font-medium text-text"
                onCommit={(label) =>
                  typeBrief(photoId, `label:${el.id}`, (b) => {
                    const t = b.elements.find((e) => e.id === el.id);
                    if (t) t.label = label;
                  })
                }
              />
              <span className="block truncate text-xs text-muted">{summary || 'No options picked — your prompt decides'}</span>
            </span>
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={false}
            aria-controls={bodyId}
            onClick={() => setExpanded(true)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 text-left focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-text">{el.label}</span>
                {worst && worst !== 'good' && <FeasibilityBadge compact feasibility={{ rating: worst, reasons: [`A chosen plant option is rated “${FEASIBILITY_META[worst].short}” for this spot.`] }} />}
                {tailorJob?.status === 'running' && <Sparkles className="size-3.5 shrink-0 animate-pulse text-accent" aria-label="Tailoring options" />}
              </span>
              <span className="block truncate text-xs text-muted">{summary || 'No options picked — your prompt decides'}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
          </button>
        )}
        {expanded && (
          <IconButton label={`Collapse ${el.label}`} size="sm" className="max-lg:size-9" aria-expanded aria-controls={bodyId} onClick={() => setExpanded(false)}>
            <ChevronDown className="size-4 rotate-180" />
          </IconButton>
        )}
        <IconButton label={`Remove ${el.label}`} size="sm" className="max-lg:size-9" onClick={() => editBrief(photoId, (b) => removeElement(b, el.id))}>
          <X className="size-4" />
        </IconButton>
      </div>

      {expanded && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-line px-3 pb-3 pt-3">
          <p className="text-xs leading-relaxed text-muted">{def.description}</p>

          <Guidance type={el.type} />

          <WherePicker el={el} photoId={photoId} scene={scene} relevantKinds={def.zoneKinds} />

          {dims.map((dim) => (
            <DimensionBlock key={dim.id} el={el} dim={dim} photoId={photoId} />
          ))}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Anything specific?</span>
            <TextInput
              value={el.note}
              maxLength={600}
              placeholder={setting === 'exterior' ? 'e.g. keep the lamp post, avoid thorny plants' : 'e.g. keep the window seat, pet-friendly finishes'}
              onChange={(e) => {
                const note = e.target.value;
                typeBrief(photoId, `note:${el.id}`, (b) => {
                  const t = b.elements.find((x) => x.id === el.id);
                  if (t) t.note = note;
                });
              }}
            />
          </label>

          <TailorSection el={el} photoId={photoId} />

          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            <div className="flex gap-1">
              <IconButton label="Move up" size="sm" className="max-lg:size-9" disabled={index === 0} onClick={() => editBrief(photoId, (b) => moveElement(b, el.id, -1))}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label="Move down" size="sm" className="max-lg:size-9" disabled={index >= count - 1} onClick={() => editBrief(photoId, (b) => moveElement(b, el.id, 1))}>
                <ArrowDown className="size-4" />
              </IconButton>
            </div>
            <Button size="sm" className="max-lg:h-9" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => editBrief(photoId, (b) => removeElement(b, el.id))}>
              Remove element
            </Button>
          </div>
        </div>
      )}
    </article>
  );
});

// ---------------------------------------------------------------------------

function Guidance({ type }: { type: ElementSpec['type'] }) {
  const g = guidanceFor(type);
  const [more, setMore] = useState(false);
  if (!g) return null;
  const rules = more ? g.rulesOfThumb : g.rulesOfThumb.slice(0, 2);
  return (
    <Callout icon={<Lightbulb className="size-4" aria-hidden />}>
      <p className="text-text">{g.purpose}</p>
      {rules.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {more && g.relateToArchitecture.length > 0 && (
        <>
          <p className="mt-2 font-medium text-text">With your architecture</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {g.relateToArchitecture.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {(g.rulesOfThumb.length > 2 || g.relateToArchitecture.length > 0) && (
        <button type="button" onClick={() => setMore(!more)} className="mt-1.5 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
          {more ? 'Fewer tips' : 'More tips'}
        </button>
      )}
    </Callout>
  );
}

// ---------------------------------------------------------------------------

function WherePicker({ el, photoId, scene, relevantKinds }: { el: ElementSpec; photoId: string; scene: SceneMap | undefined; relevantKinds: readonly ZoneKind[] }) {
  const [showAll, setShowAll] = useState(false);
  const sceneJob = useSceneJob(photoId);
  const { relevant, other } = useMemo(() => zonesForElement(scene, relevantKinds), [scene, relevantKinds]);
  const focus = (id: string | null) => useStore.getState().setStudio({ focusZoneId: id });

  if (!scene) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted">Where</span>
        <p className="text-xs text-muted">
          {sceneJob ? 'Mapping the scene… areas to choose from appear here when it is done.' : 'Map the scene to point this element at specific areas. Until then Mode decides where it goes.'}
        </p>
        {!sceneJob && (
          <Button size="sm" className="self-start max-lg:h-9" icon={<ScanSearch className="size-3.5" />} onClick={() => void mapScene(photoId)}>
            Map the scene
          </Button>
        )}
      </div>
    );
  }

  // Keep chosen zones visible even when they are not among the relevant kinds.
  const extra = other.filter((z) => el.zoneIds.includes(z.id));
  const rest = other.filter((z) => !el.zoneIds.includes(z.id));
  const visible = showAll || relevant.length + extra.length === 0 ? [...relevant, ...extra, ...rest] : [...relevant, ...extra];
  const hidden = showAll || relevant.length + extra.length === 0 ? 0 : rest.length;
  const paths = scene.paths;
  const none = visible.length === 0 && paths.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">Where</span>
        <span className="text-[11px] text-subtle">{el.zoneIds.length + el.pathIds.length ? `${el.zoneIds.length + el.pathIds.length} selected` : 'Anywhere that fits'}</span>
      </div>
      {none ? (
        <p className="text-xs text-muted">No areas mapped for this photo yet — Mode decides where it goes.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {visible.map((z) => (
            <Chip
              key={z.id}
              pressed={el.zoneIds.includes(z.id)}
              onHover={(h) => focus(h ? z.id : null)}
              title={z.description || z.label}
              onClick={() =>
                editBrief(photoId, (b) => {
                  const t = b.elements.find((e) => e.id === el.id);
                  if (t) toggleElementZone(t, z.id);
                })
              }
            >
              {z.label}
            </Chip>
          ))}
          {paths.map((p) => (
            <Chip
              key={p.id}
              icon={<Route className="size-3.5 shrink-0" aria-hidden />}
              pressed={el.pathIds.includes(p.id)}
              title={p.description || `${p.from} → ${p.to}`}
              onClick={() =>
                editBrief(photoId, (b) => {
                  const t = b.elements.find((e) => e.id === el.id);
                  if (t) toggleElementPath(t, p.id);
                })
              }
            >
              {p.label}
            </Chip>
          ))}
          {hidden > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="min-h-8 rounded-full px-2 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
              +{hidden} more area{hidden === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DimensionBlock({ el, dim, photoId }: { el: ElementSpec; dim: ElementDimension; photoId: string }) {
  const questionId = useId();
  const [compare, setCompare] = useState<string[] | null>(null);
  const health = useStore((s) => s.health);
  const blocker = generationBlocker({ health });
  const span = useMemo(() => swatchSpanIn(dim), [dim]);
  const chosen = dim.options.filter((o) => isChosen(el, dim.id, o.id));
  const comparing = compare !== null;
  const canCompare = dim.options.length >= 2;

  const pick = (o: ElementOption) => {
    if (comparing) {
      setCompare((cur) => {
        const list = cur ?? [];
        if (list.includes(o.id)) return list.filter((x) => x !== o.id);
        return list.length >= MAX_COMPARE ? list : [...list, o.id];
      });
      return;
    }
    editBrief(photoId, (b) => {
      const t = b.elements.find((e) => e.id === el.id);
      if (t) chooseOption(t, dim, o.id);
    });
  };

  const startCompare = async () => {
    if (!compare || compare.length < 2) return;
    const ids = dim.options.filter((o) => compare.includes(o.id)).map((o) => o.id);
    const id = await compareOptions(photoId, el.id, dim.id, ids);
    if (id) setCompare(null);
  };

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby={questionId}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={questionId} className="text-sm font-medium text-text">
            {dim.question}
          </h4>
          <p className="text-[11px] text-subtle">
            {dim.label} · {comparing ? `pick 2–${MAX_COMPARE} to compare` : dim.multiple ? 'pick any' : 'pick one'}
          </p>
        </div>
        {canCompare && !comparing && (
          <Button
            size="sm"
            className="max-lg:h-9"
            variant="ghost"
            icon={<GitCompare className="size-3.5" />}
            title={blocker ?? 'Render one variation per option on your photo, everything else unchanged'}
            onClick={() => setCompare(defaultCompareSelection(el, dim, 4))}
          >
            Compare
          </Button>
        )}
      </div>

      {comparing && (
        <Callout tone="accent" icon={<GitCompare className="size-4" aria-hidden />}>
          Mode renders one variation per option you pick — everything else in the brief stays the same — and shows them side by side.
        </Callout>
      )}

      <div className="grid grid-cols-3 gap-2" role={!comparing && !dim.multiple ? 'radiogroup' : 'group'} aria-labelledby={questionId}>
        {dim.options.map((o) => (
          <OptionCard
            key={o.id}
            option={o}
            span={span}
            selected={comparing ? (compare ?? []).includes(o.id) : isChosen(el, dim.id, o.id)}
            mode={comparing ? 'compare' : dim.multiple ? 'multi' : 'single'}
            onPick={() => pick(o)}
          />
        ))}
      </div>

      {comparing ? (
        <div className="flex flex-col gap-1.5">
          {blocker && <p className="text-xs text-danger">{blocker}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              className="flex-1 max-lg:h-9"
              icon={<GitCompare className="size-3.5" />}
              disabled={!compare || compare.length < 2 || !!blocker}
              onClick={() => void startCompare()}
            >
              {compare && compare.length >= 2 ? `Compare ${compare.length} on my photo` : 'Pick at least 2'}
            </Button>
            <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={() => setCompare(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        chosen.length > 0 && <ChosenDetails options={chosen} />
      )}
    </section>
  );
}

function OptionCard({
  option,
  selected,
  mode,
  span,
  onPick,
}: {
  option: ElementOption;
  selected: boolean;
  mode: 'single' | 'multi' | 'compare';
  span?: number;
  onPick: () => void;
}) {
  const f = option.feasibility;
  return (
    <button
      type="button"
      role={mode === 'single' ? 'radio' : 'checkbox'}
      aria-checked={selected}
      onClick={onPick}
      title={[option.description, option.rationale].filter(Boolean).join('\n\n') || option.label}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface text-left transition-[border-color,box-shadow]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        selected ? (mode === 'compare' ? 'border-gold ring-2 ring-gold/40' : 'border-accent ring-2 ring-accent/30') : 'border-line hover:border-line-strong',
      )}
    >
      <OptionVisualView visual={option.visual} span={span} className="aspect-square w-full" />
      {f && <FeasibilityBadge compact feasibility={f} className="absolute left-1 top-1 shadow-sm" />}
      <span
        className={cn(
          'absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border shadow-sm transition-opacity',
          selected ? (mode === 'compare' ? 'border-gold bg-gold text-white' : 'border-accent bg-accent text-accent-fg') : 'border-white/80 bg-black/20 opacity-0 group-hover:opacity-100',
          mode === 'single' ? 'rounded-full' : 'rounded-md',
        )}
        aria-hidden
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="flex flex-1 flex-col gap-0.5 p-1.5">
        <span className="line-clamp-2 text-xs font-medium leading-snug text-text">{option.label}</span>
        {option.description && <span className="line-clamp-2 text-[10.5px] leading-snug text-muted">{option.description}</span>}
      </span>
    </button>
  );
}

function ChosenDetails({ options }: { options: ElementOption[] }) {
  const items = options.filter((o) => o.rationale || (o.feasibility && o.feasibility.reasons.length));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted">
      {items.map((o) => (
        <div key={o.id} className="flex flex-col gap-1">
          <p>
            <span className="font-medium text-text">{o.label}.</span> {o.rationale}
          </p>
          {o.feasibility && o.feasibility.reasons.length > 0 && (
            <div className="flex flex-col gap-1">
              <FeasibilityBadge feasibility={o.feasibility} className="self-start" />
              <ul className="list-disc space-y-0.5 pl-4">
                {o.feasibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TailorSection({ el, photoId }: { el: ElementSpec; photoId: string }) {
  const key = tailorJobKey(el.id);
  const job = useAiJob(key);
  const aiReady = useAiReady();
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState('');
  const run = () => tailorElement(photoId, el.id, ask);

  if (job?.status === 'running') {
    return <AiProgress job={job} hint="Claude looks at your photo, its architecture and your ideas, then suggests options that suit them. Usually 20–60 seconds." />;
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-medium text-text">Tailor to my photo</p>
          <p className="mt-0.5 text-muted">
            {aiReady ? 'Get options picked for this house — its style, materials, light and your idea board.' : 'Needs AI: add ANTHROPIC_API_KEY to .env and restart the server.'}
          </p>
        </div>
      </div>
      {asking && (
        <TextInput
          autoFocus
          value={ask}
          maxLength={1000}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && aiReady) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Optional: e.g. what stone would suit a cottage look?"
          aria-label="Question for the AI (optional)"
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="max-lg:h-9" variant="soft" icon={<Sparkles className="size-3.5" />} disabled={!aiReady} onClick={run}>
          {job?.status === 'done' ? 'Tailor again' : 'Tailor options'}
        </Button>
        {!asking && aiReady && (
          <Button size="sm" className="max-lg:h-9" variant="ghost" onClick={() => setAsking(true)}>
            Ask something specific
          </Button>
        )}
      </div>
      <AiJobStatus jobKey={key} onRetry={run} />
      {job?.status === 'done' && job.info && job.info.length > 0 && (
        <Callout tone="accent" icon={<Lightbulb className="size-4" aria-hidden />} title="Tips for this house" onDismiss={() => clearAiJob(key)}>
          <ul className="list-disc space-y-0.5 pl-4">
            {job.info.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}
