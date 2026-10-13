/**
 * Scene — what Mode understood about the photo: its category, an overview
 * (viewpoint, light, orientation, boundaries), the architectural reading, the
 * mapped areas (zones) and routes (paths), what to keep and the redesign
 * opportunities. Zones can be renamed, re-rated for sun, targeted for the
 * brief, refined in Fine-tune (shared mask) or deleted.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Compass, Crosshair, Eye, Landmark, PenTool, Plus, RefreshCw, Route, ScanSearch, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import {
  EXTERIOR_SPACE_TYPES,
  INTERIOR_SPACE_TYPES,
  SPACE_TYPE_LABELS,
  type DesignBrief,
  type Photo,
  type SceneMap,
  type ScenePath,
  type SceneZone,
  type Space,
  type SpaceType,
} from '../../../../shared/types';
import { getStyle } from '../../../assets/design';
import { useStore } from '../../../state/store';
import { relativeTime } from '../../shell/format';
import { pickPhotos } from '../../shell/photoImport';
import { useSceneJob } from '../../shell/sceneJobs';
import { Badge, Button, ConfirmModal, EmptyState, IconButton, PanelHeader, Section, Select, Spinner, Swatch, Toggle, cn } from '../../common';
import { clearZoneFocus, deletePath, deleteZone, editBrief, mapScene, refineZoneOutline } from './actions';
import { appendToPrompt, toggleTargetZone } from './briefOps';
import { useStudioContext } from './context';
import { zoneIcon } from './icons';
import { AiUnavailableNote, Callout, InlineText, useAiReady } from './ui';
import { GROUND_ZONE_KINDS, PATH_KIND_LABELS, SUN_OPTIONS, splitZones, sunLabel, zoneKindLabel } from './zones';

export function ScenePanel() {
  const { project, space, photo, scene, brief } = useStudioContext();
  if (!project) return null;
  if (!space || !photo) {
    return (
      <EmptyState
        icon={<ScanSearch className="size-6" />}
        title="No photo to map yet"
        action={
          space && (
            <Button variant="primary" onClick={() => pickPhotos(space.id)}>
              Add photos
            </Button>
          )
        }
      >
        Add a photo of a room or the outside of your house. Mode maps its areas, paths and architecture so your changes land in the right places.
      </EmptyState>
    );
  }
  return <SceneView space={space} photo={photo} scene={scene} brief={brief} />;
}

function SceneView({ space, photo, scene, brief }: { space: Space; photo: Photo; scene: SceneMap | undefined; brief: DesignBrief }) {
  const job = useSceneJob(photo.id);
  const aiReady = useAiReady();
  const [confirmRemap, setConfirmRemap] = useState(false);
  useEffect(() => clearZoneFocus, []);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader
        title="Scene"
        subtitle="What Mode sees in this photo — the areas, paths and architecture it designs around."
        action={
          scene &&
          !job && (
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5 max-lg:h-9" />} disabled={!aiReady} onClick={() => setConfirmRemap(true)}>
              Re-map
            </Button>
          )
        }
      />

      {job && <MappingProgress queued={job === 'queued'} remapping={!!scene} />}

      {!scene ? (
        !job && <NotMapped photoId={photo.id} />
      ) : (
        <>
          <Overview space={space} photo={photo} scene={scene} />
          <Architecture scene={scene} />
          <Zones photo={photo} scene={scene} brief={brief} setting={space.kind} />
          <Paths photo={photo} paths={scene.paths} />
          {scene.keep.length > 0 && (
            <Section title="Worth keeping">
              <ul className="flex flex-col gap-1.5 text-sm text-text">
                {scene.keep.map((k) => (
                  <li key={k} className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span>{k}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Opportunities photoId={photo.id} items={scene.opportunities} prompt={brief.prompt} />
          <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3 text-[11px] text-subtle">
            <span>
              Mapped {relativeTime(scene.createdAt)}
              {scene.model ? ` · ${scene.model}` : ''}
            </span>
            <button type="button" onClick={() => setConfirmClear(true)} className="font-medium text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-accent">
              Clear map
            </button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmRemap}
        onClose={() => setConfirmRemap(false)}
        title="Map this photo again?"
        message="Mode analyzes the photo again and replaces the current areas, paths and architecture notes. Areas picked in your brief will need to be picked again."
        confirmLabel="Re-map"
        danger={false}
        onConfirm={() => void mapScene(photo.id, true)}
      />
      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear the scene map?"
        message="The areas, paths and architecture notes of this photo are removed (you can undo this). Variations already generated are kept."
        confirmLabel="Clear map"
        onConfirm={() => {
          useStore.getState().setScene(photo.id, undefined);
          useStore.getState().setStudio({ focusZoneId: null });
        }}
      />
    </div>
  );
}

function MappingProgress({ queued, remapping }: { queued: boolean; remapping: boolean }) {
  return (
    <div className="px-4 pt-4">
      <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2.5 text-xs">
        <Spinner className="size-4 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="font-medium text-text">{queued ? 'Waiting to map the scene…' : remapping ? 'Re-mapping the scene…' : 'Mapping the scene…'}</p>
          <p className="mt-0.5 text-muted">Claude is outlining the areas, routes, sun and architecture. Usually 30–90 seconds — you can keep working meanwhile.</p>
        </div>
      </div>
    </div>
  );
}

function NotMapped({ photoId }: { photoId: string }) {
  const aiReady = useAiReady();
  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="rounded-2xl bg-accent-soft p-3 text-accent">
          <ScanSearch className="size-6" aria-hidden />
        </div>
        <p className="font-medium text-text">Map this photo</p>
        <p className="max-w-xs text-sm text-muted">Mode reads the photo like a designer would:</p>
      </div>
      <ul className="mx-auto flex max-w-xs flex-col gap-1.5 text-sm text-muted">
        {[
          'what it shows (front yard, kitchen…) and its viewpoint',
          'labeled areas with outlines — facade, door, walkway, lawn, beds / walls, floor, cabinets',
          'routes like “driveway → front door”, with surface and width',
          'sun and orientation for every planting area',
          'the architectural style, materials and design language to respect',
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <Button variant="primary" className="self-center" icon={<Sparkles className="size-4" />} disabled={!aiReady} onClick={() => void mapScene(photoId)}>
        Map the scene
      </Button>
      <AiUnavailableNote feature="Scene mapping" />
      <p className="text-center text-xs text-subtle">No map yet? You can still describe changes on the Design tab — the whole photo may change.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategorySelect({ value, onChange }: { value: SpaceType; onChange: (v: SpaceType) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as SpaceType)} aria-label="Photo category" className="h-8 text-xs">
      <optgroup label="Outside">
        {EXTERIOR_SPACE_TYPES.map((t) => (
          <option key={t} value={t}>
            {SPACE_TYPE_LABELS[t]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Inside">
        {INTERIOR_SPACE_TYPES.map((t) => (
          <option key={t} value={t}>
            {SPACE_TYPE_LABELS[t]}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

const dismissedMismatch = new Set<string>();

function Overview({ space, photo, scene }: { space: Space; photo: Photo; scene: SceneMap }) {
  const [hideMismatch, setHideMismatch] = useState(() => dismissedMismatch.has(photo.id));
  const showZones = useStore((s) => s.studio.showZones);
  const facts = [
    { label: 'Viewpoint', value: scene.viewpoint },
    { label: 'Light', value: scene.lighting },
    { label: 'Orientation', value: scene.orientation },
    { label: 'Boundaries', value: scene.boundaries },
  ].filter((f) => f.value?.trim());
  const mismatch = scene.category !== space.type && !hideMismatch;

  return (
    <Section title="Overview" action={<Toggle checked={showZones} onChange={(v) => useStore.getState().setStudio({ showZones: v })} label={<span className="text-xs text-muted">Show on photo</span>} />}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-muted">This photo shows</span>
        <div className="min-w-0 flex-1">
          <CategorySelect value={scene.category} onChange={(v) => useStore.getState().updateScene(photo.id, (sc) => void (sc.category = v), {})} />
        </div>
      </div>
      {mismatch && (
        <Callout
          tone="info"
          onDismiss={() => {
            dismissedMismatch.add(photo.id);
            setHideMismatch(true);
          }}
          action={
            <Button size="sm" className="max-lg:h-9" onClick={() => useStore.getState().updateSpace(space.id, { type: scene.category })}>
              Make “{space.name}” a {SPACE_TYPE_LABELS[scene.category].toLowerCase()}
            </Button>
          }
        >
          Mode reads this photo as a <span className="font-medium text-text">{SPACE_TYPE_LABELS[scene.category].toLowerCase()}</span>, but the space is set to{' '}
          {SPACE_TYPE_LABELS[space.type].toLowerCase()}. The space type decides which design elements are offered.
        </Callout>
      )}
      {scene.summary && <p className="text-sm leading-relaxed text-text">{scene.summary}</p>}
      {facts.length > 0 && (
        <dl className="flex flex-col gap-2 text-xs">
          {facts.map((f) => (
            <div key={f.label} className="grid grid-cols-[5.5rem_1fr] gap-2">
              <dt className="font-medium text-muted">{f.label}</dt>
              <dd className="text-text">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

function TagList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text">
          {t}
        </span>
      ))}
    </div>
  );
}

function Architecture({ scene }: { scene: SceneMap }) {
  const a = scene.architecture;
  const style = a.styleId ? getStyle(a.styleId) : undefined;
  const [showAvoid, setShowAvoid] = useState(false);
  return (
    <Section title="Architecture">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Landmark className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight text-text">{a.style || 'Style not identified'}</p>
          {(a.era || style) && (
            <p className="mt-0.5 text-xs text-muted">
              {[a.era, style && style.name !== a.style ? `Closest style: ${style.name}` : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {a.features.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted">Defining features</p>
          <TagList items={a.features} />
        </div>
      )}
      {a.materials.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted">Materials & colors</p>
          <TagList items={a.materials} />
        </div>
      )}
      {a.proportions && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">Scale & proportion</p>
          <p className="text-sm text-text">{a.proportions}</p>
        </div>
      )}
      {a.designLanguage.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">Design language to respect</p>
          <ul className="list-disc space-y-1 pl-4 text-sm text-text">
            {a.designLanguage.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {a.purpose.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">How the space is used</p>
          <ul className="list-disc space-y-1 pl-4 text-sm text-text">
            {a.purpose.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {style && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-medium text-text">
            {style.name} <span className="font-normal text-muted">· {style.era}</span>
          </p>
          {style.palettes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] text-muted">Period-appropriate palettes</p>
              {style.palettes.slice(0, 3).map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <div className="flex shrink-0 gap-1">
                    {p.hexes.map((h, i) => (
                      <Swatch key={`${h}${i}`} hex={h} size="sm" title={h} />
                    ))}
                  </div>
                  <span className="truncate text-xs text-text">{p.name}</span>
                </div>
              ))}
            </div>
          )}
          {style.avoid.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowAvoid(!showAvoid)} className="text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                {showAvoid ? 'Hide what to avoid' : 'What to avoid with this style'}
              </button>
              {showAvoid && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted">
                  {style.avoid.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

function Zones({ photo, scene, brief, setting }: { photo: Photo; scene: SceneMap; brief: DesignBrief; setting: 'interior' | 'exterior' }) {
  const { design, context } = useMemo(() => splitZones(scene.zones), [scene.zones]);
  const targeted = useMemo(() => new Set(brief.targetZoneIds), [brief.targetZoneIds]);
  return (
    <Section title={`Areas · ${design.length}`} action={<span className="text-[11px] text-subtle">Tap ⊕ to include in the brief</span>}>
      {design.length === 0 ? (
        <p className="text-xs text-muted">No editable areas were found. Try re-mapping, or sketch an area on the photo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {design.map((z) => (
            <ZoneRow key={z.id} zone={z} photo={photo} targeted={targeted.has(z.id)} setting={setting} />
          ))}
        </ul>
      )}
      {context.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted">Context — left as is</p>
          <div className="flex flex-wrap gap-1.5">
            {context.map((z) => {
              const Icon = zoneIcon(z.kind);
              return (
                <span
                  key={z.id}
                  title={z.description || z.label}
                  onPointerEnter={() => useStore.getState().setStudio({ focusZoneId: z.id })}
                  onPointerLeave={() => useStore.getState().setStudio({ focusZoneId: null })}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {z.label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function ZoneRow({ zone, photo, targeted, setting }: { zone: SceneZone; photo: Photo; targeted: boolean; setting: 'interior' | 'exterior' }) {
  const focused = useStore((s) => s.studio.focusZoneId === zone.id);
  const [open, setOpen] = useState(false);
  const Icon = zoneIcon(zone.kind);
  const focus = (on: boolean) => {
    const s = useStore.getState();
    if (on) s.setStudio({ focusZoneId: zone.id });
    else if (s.studio.focusZoneId === zone.id) s.setStudio({ focusZoneId: null });
  };
  const showSun = setting === 'exterior' && (GROUND_ZONE_KINDS.includes(zone.kind) || !!zone.sun);
  const edit = (recipe: (z: SceneZone) => void, coalesce?: string) =>
    useStore.getState().updateScene(
      photo.id,
      (sc) => {
        const z = sc.zones.find((x) => x.id === zone.id);
        if (z) recipe(z as SceneZone);
      },
      coalesce ? { coalesce } : {},
    );

  return (
    <li
      onPointerEnter={() => focus(true)}
      onPointerLeave={() => focus(false)}
      className={cn('rounded-xl border bg-surface p-2.5 transition-colors', focused ? 'border-accent/50 bg-accent-soft/40' : 'border-line')}
    >
      <div className="flex items-start gap-2">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', targeted ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <InlineText value={zone.label} label="Rename area" className="max-w-full text-sm font-medium text-text" onCommit={(label) => edit((z) => void (z.label = label), `zone-label:${zone.id}`)} />
          <p className="truncate text-[11px] text-subtle">
            {zoneKindLabel(zone.kind)}
            {zone.maskId ? ' · outline refined' : ''}
            {!showSun && zone.sun ? ` · ${sunLabel(zone.sun)}` : ''}
          </p>
        </div>
        <IconButton
          label={targeted ? 'Remove from the areas that may change' : 'Add to the areas that may change'}
          size="sm" className="max-lg:size-9"
          active={targeted}
          onClick={() => editBrief(photo.id, (b) => toggleTargetZone(b, zone.id))}
          onFocus={() => focus(true)}
          onBlur={() => focus(false)}
        >
          {targeted ? <Crosshair className="size-4" /> : <Plus className="size-4" />}
        </IconButton>
      </div>

      {zone.description && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={cn('mt-1.5 w-full text-left text-xs leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-accent', !open && 'line-clamp-2')}
        >
          {zone.description}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {showSun && (
          <Select
            value={zone.sun ?? ''}
            aria-label={`Sun on ${zone.label}`}
            onChange={(e) => {
              const v = e.target.value as SceneZone['sun'] | '';
              edit((z) => {
                if (v) z.sun = v;
                else delete z.sun;
              });
            }}
            className="h-8 w-auto py-0 pl-2 text-xs"
          >
            <option value="">Sun: not set</option>
            {SUN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <Button size="sm" variant="ghost" icon={<PenTool className="size-3.5 max-lg:h-9" />} onClick={() => void refineZoneOutline(photo.id, zone.id)} title="Outline this area precisely with the Fine-tune brush and wand">
          Refine outline
        </Button>
        <span className="flex-1" />
        <IconButton
          label={`Delete ${zone.label}`}
          size="sm" className="max-lg:size-9"
          onClick={() => {
            deleteZone(photo.id, zone.id);
            useStore.getState().notify(`Deleted “${zone.label}”. Undo brings it back.`, 'info');
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function Paths({ photo, paths }: { photo: Photo; paths: ScenePath[] }) {
  if (paths.length === 0) return null;
  return (
    <Section title={`Paths · ${paths.length}`}>
      <ul className="flex flex-col gap-2">
        {paths.map((p) => (
          <li key={p.id} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
              <Route className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <InlineText
                  value={p.label}
                  label="Rename path"
                  className="min-w-0 text-sm font-medium text-text"
                  onCommit={(label) =>
                    useStore.getState().updateScene(
                      photo.id,
                      (sc) => {
                        const x = sc.paths.find((y) => y.id === p.id);
                        if (x) x.label = label;
                      },
                      { coalesce: `path-label:${p.id}` },
                    )
                  }
                />
                {p.kind !== 'existing' && <Badge tone={p.kind === 'sketch' ? 'accent' : 'neutral'}>{PATH_KIND_LABELS[p.kind]}</Badge>}
              </div>
              {(p.from || p.to) && (
                <p className="flex items-center gap-1 text-[11px] text-subtle">
                  <Compass className="size-3" aria-hidden />
                  {p.from || 'start'} → {p.to || 'end'}
                </p>
              )}
              {p.description && <p className="mt-1 text-xs leading-relaxed text-muted">{p.description}</p>}
            </div>
            <IconButton
              label={`Delete ${p.label}`}
              size="sm" className="max-lg:size-9"
              onClick={() => {
                deletePath(photo.id, p.id);
                useStore.getState().notify(`Deleted “${p.label}”. Undo brings it back.`, 'info');
              }}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Opportunities({ photoId, items, prompt }: { photoId: string; items: string[]; prompt: string }) {
  if (items.length === 0) return null;
  const inPrompt = (t: string) => prompt.toLowerCase().includes(t.trim().toLowerCase().replace(/[.!]+$/, ''));
  return (
    <Section title="Opportunities">
      <ul className="flex flex-col gap-2">
        {items.map((t) => {
          const added = inPrompt(t);
          return (
            <li key={t} className="flex items-start gap-2 text-sm text-text">
              <Eye className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1">{t}</span>
              <Button
                size="sm"
                variant={added ? 'ghost' : 'soft'}
                disabled={added}
                icon={added ? <Check className="size-3.5 max-lg:h-9" /> : <Plus className="size-3.5" />}
                onClick={() => {
                  editBrief(photoId, (b) => void appendToPrompt(b, t));
                  useStore.getState().notify('Added to your brief’s description.', 'success');
                }}
              >
                {added ? 'In brief' : 'Add'}
              </Button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
