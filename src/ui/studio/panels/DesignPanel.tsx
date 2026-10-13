/**
 * Design (brief composer) — the heart of the Studio. The user composes the
 * rendition from design elements (Pathway, Planting bed, Wall paint…) whose
 * questions show visual options to compare, picks the areas that may change,
 * plant maturity and inspiration, adds a free-text prompt, and generates
 * photoreal variations.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, Crosshair, ImagePlus, Lightbulb, Loader2, Minus, Plus, ScanSearch, Sparkles, Sprout, WandSparkles } from 'lucide-react';
import type { DesignBrief, ElementType, IdeaItem, Photo, Project, SceneMap, Space } from '../../../../shared/types';
import { elementsForSetting } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { pickPhotos } from '../../shell/photoImport';
import { useSceneJob } from '../../shell/sceneJobs';
import { Button, EmptyState, IconButton, PanelHeader, Section, Segmented, TextArea, Toggle } from '../../common';
import { generationBlocker } from '../generate';
import { addElement, clearZoneFocus, editBrief, generateBrief, mapScene, openRunGrid, typeBrief } from './actions';
import { PLANT_MATURITY_OPTIONS, hasCustomIdeas, includedIdeaIds, isBriefEmpty, resetIdeas, toggleIdea, toggleTargetZone } from './briefOps';
import { useStudioContext } from './context';
import { ElementCard } from './ElementCard';
import { elementIcon } from './icons';
import { BlobImage, Callout, Chip, ClimateCallout } from './ui';
import { isDesignZone } from './zones';

const PALETTE_PREVIEW = 9;
const ZONE_PREVIEW = 10;

export function DesignPanel() {
  const { project, space, photo, scene, brief, setting } = useStudioContext();
  if (!project) return null;
  if (!space) {
    return (
      <EmptyState icon={<Blocks className="size-6" />} title="Choose a space to design">
        Pick a room or part of the outside in the spaces list, or add one — then add a photo of it.
        <MobileSpacesButton />
      </EmptyState>
    );
  }
  if (!photo) {
    return (
      <EmptyState
        icon={<ImagePlus className="size-6" />}
        title={`Add a photo of ${space.name}`}
        action={
          <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => pickPhotos(space.id)}>
            Add photos
          </Button>
        }
      >
        Your design brief is built on a photo: Mode maps it, then you compose changes from design elements and compare photoreal variations.
      </EmptyState>
    );
  }
  return <BriefComposer project={project} space={space} photo={photo} scene={scene} brief={brief} setting={setting} />;
}

function MobileSpacesButton() {
  return (
    <div className="mt-3 lg:hidden">
      <Button size="sm" className="max-lg:h-9" onClick={() => useStore.getState().setView({ mobilePane: 'spaces' })}>
        Open spaces
      </Button>
    </div>
  );
}

function BriefComposer({
  project,
  space,
  photo,
  scene,
  brief,
  setting,
}: {
  project: Project;
  space: Space;
  photo: Photo;
  scene: SceneMap | undefined;
  brief: DesignBrief;
  setting: 'interior' | 'exterior';
}) {
  const activeElementId = useStore((s) => s.studio.activeElementId);
  const scrollTarget = useRef<string | null>(null);
  useEffect(() => clearZoneFocus, []);

  useEffect(() => {
    const id = scrollTarget.current;
    if (!id || id !== activeElementId) return;
    scrollTarget.current = null;
    requestAnimationFrame(() => document.querySelector(`[data-element-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, [activeElementId, brief.elements.length]);

  const onAdd = (type: ElementType) => {
    const id = addElement(photo.id, type);
    if (id) scrollTarget.current = id;
  };

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader
        title="Design brief"
        subtitle="Compose your idea from design elements, then generate photoreal variations of your photo."
      />

      {setting === 'exterior' && (
        <div className="px-4 pt-4">
          <ClimateCallout setting={setting} />
        </div>
      )}

      <Section
        title="Design elements"
        action={brief.elements.length > 0 && <span className="text-xs tabular-nums text-subtle">{brief.elements.length} in brief</span>}
      >
        {brief.elements.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">
            Build the look from simple building blocks. Each element asks a few visual questions — like stone size or path shape — so you can compare options before you
            generate.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {brief.elements.map((el, i) => (
              <ElementCard
                key={el.id}
                el={el}
                photoId={photo.id}
                scene={scene}
                location={project.location}
                setting={setting}
                expanded={activeElementId === el.id}
                targetZoneIds={brief.targetZoneIds}
                index={i}
                count={brief.elements.length}
              />
            ))}
          </div>
        )}
        <ElementPalette setting={setting} brief={brief} onAdd={onAdd} />
      </Section>

      <AreasSection photo={photo} scene={scene} brief={brief} />

      {setting === 'exterior' && (
        <Section title="Plants">
          <PlantMaturity photoId={photo.id} value={brief.plantMaturity} />
        </Section>
      )}

      <InspirationSection project={project} space={space} photoId={photo.id} brief={brief} />

      <Section title="Describe it">
        <TextArea
          value={brief.prompt}
          maxLength={4000}
          rows={4}
          aria-label="Describe the changes you want"
          placeholder={
            setting === 'exterior'
              ? 'e.g. A welcoming entry: a wider curved bluestone path, layered foundation planting, warm lantern light at the door.'
              : 'e.g. Brighter and calmer: warm white walls, light oak floors, linen curtains and brass lighting.'
          }
          onChange={(e) => {
            const prompt = e.target.value;
            typeBrief(photo.id, 'prompt', (b) => {
              b.prompt = prompt;
            });
          }}
        />
        <p className="text-[11px] text-subtle">Mention what to keep, too — “keep the brick steps and the maple”.</p>
      </Section>

      <GenerateFooter photo={photo} brief={brief} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ElementPalette({ setting, brief, onAdd }: { setting: 'interior' | 'exterior'; brief: DesignBrief; onAdd: (type: ElementType) => void }) {
  const [all, setAll] = useState(false);
  const defs = useMemo(() => {
    const list = elementsForSetting(setting);
    // "Something else" (custom) last.
    return [...list.filter((d) => d.type !== 'custom'), ...list.filter((d) => d.type === 'custom')];
  }, [setting]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of brief.elements) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [brief.elements]);
  const shown = all ? defs : defs.slice(0, PALETTE_PREVIEW);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted">{brief.elements.length ? 'Add another element' : 'Add a design element'}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {shown.map((def) => {
          const Icon = elementIcon(def.icon);
          const n = counts.get(def.type) ?? 0;
          return (
            <button
              key={def.type}
              type="button"
              title={def.description}
              onClick={() => onAdd(def.type)}
              className="relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-1 py-2 text-center text-[11px] font-medium leading-tight text-text transition-colors hover:border-accent/50 hover:bg-accent-soft/50 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Icon className="size-[18px] text-accent" aria-hidden />
              <span className="line-clamp-2">{def.label}</span>
              {n > 0 && (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-accent-fg" aria-label={`${n} in brief`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {defs.length > PALETTE_PREVIEW && (
        <button type="button" onClick={() => setAll(!all)} className="self-start text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
          {all ? 'Show fewer' : `Show all ${defs.length} elements`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AreasSection({ photo, scene, brief }: { photo: Photo; scene: SceneMap | undefined; brief: DesignBrief }) {
  const showZones = useStore((s) => s.studio.showZones);
  const sceneJob = useSceneJob(photo.id);
  const [all, setAll] = useState(false);
  const focus = (id: string | null) => useStore.getState().setStudio({ focusZoneId: id });
  const zones = useMemo(() => (scene?.zones ?? []).filter(isDesignZone), [scene]);
  const targeted = useMemo(() => new Set(brief.targetZoneIds), [brief.targetZoneIds]);
  const fromElements = useMemo(() => {
    const ids = new Set(brief.elements.flatMap((e) => e.zoneIds));
    for (const id of brief.targetZoneIds) ids.delete(id);
    return zones.filter((z) => ids.has(z.id));
  }, [brief.elements, brief.targetZoneIds, zones]);
  const pathCount = useMemo(() => new Set(brief.elements.flatMap((e) => e.pathIds)).size, [brief.elements]);
  const ordered = useMemo(() => [...zones.filter((z) => targeted.has(z.id)), ...zones.filter((z) => !targeted.has(z.id))], [zones, targeted]);
  const visible = all ? ordered : ordered.slice(0, Math.max(ZONE_PREVIEW, brief.targetZoneIds.length));
  const nothingTargeted = brief.targetZoneIds.length === 0 && fromElements.length === 0 && pathCount === 0;

  return (
    <Section
      title="Areas that may change"
      action={scene && <Toggle checked={showZones} onChange={(v) => useStore.getState().setStudio({ showZones: v })} label={<span className="text-xs text-muted">Show on photo</span>} />}
    >
      <Segmented
        size="sm"
        value={brief.scope}
        onChange={(scope) => editBrief(photo.id, (b) => void (b.scope = scope))}
        options={[
          { value: 'zones', label: 'Selected areas', title: 'Only the areas you pick (and your elements’ areas) change' },
          { value: 'whole', label: 'Whole image', title: 'Anything in the photo may change' },
        ]}
      />
      {brief.scope === 'whole' ? (
        <p className="text-xs text-muted">Anything in the photo may change. Switch to “Selected areas” to protect everything outside the parts you pick.</p>
      ) : !scene ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {sceneJob ? 'Mapping the scene… you can pick areas when it finishes.' : 'Map the scene to pick exactly which areas may change. Until then the whole photo may change.'}
          </p>
          {!sceneJob && (
            <Button size="sm" className="self-start max-lg:h-9" icon={<ScanSearch className="size-3.5" />} onClick={() => void mapScene(photo.id)}>
              Map the scene
            </Button>
          )}
        </div>
      ) : (
        <>
          {zones.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {visible.map((z) => (
                <Chip
                  key={z.id}
                  pressed={targeted.has(z.id)}
                  icon={targeted.has(z.id) ? <Crosshair className="size-3.5 shrink-0" aria-hidden /> : undefined}
                  title={z.description || z.label}
                  onHover={(h) => focus(h ? z.id : null)}
                  onClick={() => editBrief(photo.id, (b) => toggleTargetZone(b, z.id))}
                >
                  {z.label}
                </Chip>
              ))}
              {ordered.length > visible.length && (
                <button type="button" onClick={() => setAll(true)} className="min-h-8 px-2 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                  +{ordered.length - visible.length} more
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">The scene map has no editable areas. Re-map it from the Scene tab, or switch to “Whole image”.</p>
          )}
          {fromElements.length > 0 && (
            <p className="text-xs text-muted">
              Also changing for your elements: <span className="text-text">{fromElements.map((z) => z.label).join(', ')}</span>
              {pathCount > 0 && ` and ${pathCount} path${pathCount === 1 ? '' : 's'}`}.
            </p>
          )}
          {nothingTargeted ? (
            <Callout tone="warning">Nothing picked yet, so the whole photo may change. Tap areas here or on the photo to keep the rest untouched.</Callout>
          ) : (
            <p className="text-[11px] text-subtle">Tip: tap areas on the photo to add or remove them.</p>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function PlantMaturity({ photoId, value }: { photoId: string; value: DesignBrief['plantMaturity'] }) {
  const hint = PLANT_MATURITY_OPTIONS.find((o) => o.value === value)?.hint;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Sprout className="size-3.5 text-success" aria-hidden />
        Show new plants as
      </p>
      <Segmented
        size="sm"
        className="w-full"
        value={value}
        onChange={(v) => editBrief(photoId, (b) => void (b.plantMaturity = v))}
        options={PLANT_MATURITY_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.hint }))}
      />
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InspirationSection({ project, space, photoId, brief }: { project: Project; space: Space; photoId: string; brief: DesignBrief }) {
  const board = project.ideaBoard;
  const included = useMemo(() => new Set(includedIdeaIds(board, brief, space.id)), [board, brief, space.id]);
  const relevant: IdeaItem[] = useMemo(
    () => board.filter((i) => included.has(i.id) || i.spaceIds.length === 0 || i.spaceIds.includes(space.id)),
    [board, included, space.id],
  );
  const custom = hasCustomIdeas(brief);
  const openIdeas = () => useStore.getState().setStudio({ panel: 'ideas' });

  return (
    <Section
      title="Inspiration"
      action={
        relevant.length > 0 && (
          <button type="button" onClick={openIdeas} className="text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            Idea board
          </button>
        )
      }
    >
      {relevant.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">Inspiration images, notes, design themes and real products from your idea board guide every variation.</p>
          <Button size="sm" icon={<Lightbulb className="size-3.5 max-lg:h-9" />} onClick={openIdeas}>
            Add inspiration
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {relevant.map((item) => (
              <Chip
                key={item.id}
                pressed={included.has(item.id)}
                title={item.note || item.aiDescription || item.title}
                onClick={() => editBrief(photoId, (b) => toggleIdea(b, board, space.id, item.id))}
                icon={
                  item.thumbId ? (
                    <span className="-ml-1.5 size-6 shrink-0 overflow-hidden rounded-full">
                      <BlobImage imageId={item.thumbId} alt="" />
                    </span>
                  ) : item.colors.length > 0 ? (
                    <span className="-ml-1 flex size-4 shrink-0 overflow-hidden rounded-full" aria-hidden>
                      {item.colors.slice(0, 3).map((c) => (
                        <span key={c} className="h-full flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </span>
                  ) : undefined
                }
              >
                {item.title || 'Untitled idea'}
              </Chip>
            ))}
          </div>
          <p className="text-[11px] text-subtle">
            {custom ? (
              <>
                Your own pick for this brief ·{' '}
                <button type="button" onClick={() => editBrief(photoId, resetIdeas)} className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                  Use the active ideas instead
                </button>
              </>
            ) : (
              'Using the ideas marked active on your board. Tap to include or leave out.'
            )}
          </p>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function GenerateFooter({ photo, brief }: { photo: Photo; brief: DesignBrief }) {
  const count = useStore((s) => s.studio.variationCount);
  const health = useStore((s) => s.health);
  const viewing = useStore((s) => s.studio.viewVariationId);
  // Primitive / store-owned selections only (a fresh object per call would re-render forever).
  const runningId = useStore((s) => photo.generations.find((g) => !!s.runs[g.id])?.id ?? null);
  const progress = useStore((s) => (runningId ? s.runs[runningId] : undefined));
  const running = runningId && progress ? { id: runningId, progress } : null;
  const [starting, setStarting] = useState(false);
  const blocker = generationBlocker({ health });
  const empty = isBriefEmpty(brief);
  const setCount = (n: number) => useStore.getState().setStudio({ variationCount: Math.min(6, Math.max(1, n)) });

  const generate = async () => {
    setStarting(true);
    try {
      await generateBrief(photo.id);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      {running && (
        <div className="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin text-accent" aria-hidden />
          <span className="flex-1">
            {running.progress.stage === 'planning'
              ? 'Planning your variations…'
              : `Rendering · ${running.progress.done} of ${running.progress.total} ready${running.progress.failed ? ` · ${running.progress.failed} failed` : ''}`}
          </span>
          <button type="button" onClick={() => openRunGrid(running.id)} className="font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            View
          </button>
        </div>
      )}
      {blocker ? (
        <p className="text-xs text-danger">{blocker}</p>
      ) : empty ? (
        <p className="text-xs text-muted">Add a design element or describe the change to generate.</p>
      ) : viewing ? (
        <p className="flex items-center gap-1 text-xs text-muted">
          <WandSparkles className="size-3.5 text-accent" aria-hidden /> Starts from the variation you're viewing.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line" role="group" aria-label="Number of variations">
          <IconButton label="Fewer variations" size="sm" className="max-lg:size-9" disabled={count <= 1} onClick={() => setCount(count - 1)}>
            <Minus className="size-3.5" />
          </IconButton>
          <span className="w-5 text-center text-sm font-medium tabular-nums text-text" aria-live="polite">
            {count}
          </span>
          <IconButton label="More variations" size="sm" className="max-lg:size-9" disabled={count >= 6} onClick={() => setCount(count + 1)}>
            <Plus className="size-3.5" />
          </IconButton>
        </div>
        <Button
          variant="primary"
          className="flex-1"
          icon={<Sparkles className="size-4" />}
          loading={starting}
          disabled={empty || !!blocker}
          onClick={() => void generate()}
        >
          Generate {count} variation{count === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
