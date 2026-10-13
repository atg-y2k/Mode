/**
 * Suggestions — AI recommendations for the photo (or the variation being
 * viewed), grounded in its scene map, architecture, idea board and climate.
 * Each card can be added to the brief (prompt + element + target areas) or
 * generated right away.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Plus, RefreshCw, ScanSearch, Sparkles } from 'lucide-react';
import type { Photo, Recommendation, SceneMap } from '../../../../shared/types';
import { getElementDef } from '../../../assets/design';
import { findVariation, useStore } from '../../../state/store';
import { relativeTime } from '../../shell/format';
import { pickPhotos } from '../../shell/photoImport';
import { useSceneJob } from '../../shell/sceneJobs';
import { useDeviceMapping } from '../../../vision/ui/jobs';
import { Button, EmptyState, PanelHeader, Section, TextInput } from '../../common';
import { generationBlocker } from '../generate';
import { addRecommendationToBrief, clearZoneFocus, fetchSuggestions, generateRecommendation, mapScene, suggestionsJobKey } from './actions';
import { useAiJob } from './aiJobs';
import { useStudioContext } from './context';
import { RECOMMENDATION_META, elementIcon } from './icons';
import { AiJobStatus, AiUnavailableNote, Callout, ClimateCallout, useAiReady } from './ui';

export function SuggestionsPanel() {
  const { project, space, photo, scene, setting } = useStudioContext();
  if (!project) return null;
  if (!space || !photo) {
    return (
      <EmptyState
        icon={<Sparkles className="size-6" />}
        title="Suggestions need a photo"
        action={
          space && (
            <Button variant="primary" onClick={() => pickPhotos(space.id)}>
              Add photos
            </Button>
          )
        }
      >
        Add a photo and Mode suggests improvements that suit the house, your idea board and your climate.
      </EmptyState>
    );
  }
  return <Suggestions photo={photo} scene={scene} setting={setting} />;
}

function Suggestions({ photo, scene, setting }: { photo: Photo; scene: SceneMap | undefined; setting: 'interior' | 'exterior' }) {
  const [focus, setFocus] = useState('');
  const aiReady = useAiReady();
  useEffect(() => clearZoneFocus, []);
  const job = useAiJob(suggestionsJobKey(photo.id));
  const claudeMapping = useSceneJob(photo.id);
  const deviceMapping = useDeviceMapping(photo.id);
  const sceneJob = !!claudeMapping || deviceMapping;
  const viewing = useStore((s) => s.studio.viewVariationId);
  const recs = photo.recommendations;
  const running = job?.status === 'running';
  const run = (e?: FormEvent) => {
    e?.preventDefault();
    fetchSuggestions(photo.id, focus);
  };
  const viewingVariation = viewing ? findVariation(photo, viewing) : undefined;
  const basedOn = recs?.baseVariationId ? findVariation(photo, recs.baseVariationId) : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <PanelHeader title="Suggestions" subtitle="Ideas for this photo from its scene, your idea board and your climate — add one to the brief or generate it." />

      <Section>
        <form onSubmit={run} className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted" htmlFor="suggest-focus">
            Focus (optional)
          </label>
          <TextInput
            id="suggest-focus"
            value={focus}
            maxLength={1000}
            onChange={(e) => setFocus(e.target.value)}
            placeholder={setting === 'exterior' ? 'e.g. curb appeal under $3k, more privacy, less lawn' : 'e.g. make it feel bigger, kid-proof, more storage'}
          />
          <Button type="submit" variant={recs ? 'secondary' : 'primary'} icon={recs ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />} disabled={!aiReady || running}>
            {recs ? 'New suggestions' : 'Get suggestions'}
          </Button>
          <p className="text-[11px] text-subtle">
            {viewingVariation ? `Suggests changes to the variation you're viewing (“${viewingVariation.title}”).` : 'Suggests changes to the original photo.'}
          </p>
        </form>
        <AiUnavailableNote action="get suggestions" />
        <AiJobStatus jobKey={suggestionsJobKey(photo.id)} hint="Claude studies the photo, its architecture and your ideas. Usually 30–90 seconds." onRetry={() => run()} />
        {!scene && !running && (
          <Callout
            icon={<ScanSearch className="size-4" aria-hidden />}
            action={
              !sceneJob && (
                <Button size="sm" className="max-lg:h-9" onClick={() => void mapScene(photo.id)}>
                  Map the scene
                </Button>
              )
            }
          >
            {sceneJob ? 'Mapping the scene… suggestions will be able to target specific areas once it is done.' : 'Map the scene first and suggestions can point at specific areas (the walkway, the beds by the porch…).'}
          </Callout>
        )}
        <ClimateCallout setting={setting} />
      </Section>

      {recs && recs.items.length > 0 ? (
        <section className="flex flex-col gap-3 px-4 py-4" aria-label="Suggestions">
          <p className="text-[11px] text-subtle">
            {recs.items.length} suggestion{recs.items.length === 1 ? '' : 's'} · {relativeTime(recs.createdAt)}
            {basedOn ? ` · for “${basedOn.title}”` : recs.baseVariationId ? ' · for a variation since deleted' : ''}
          </p>
          <ul className="flex flex-col gap-3">
            {recs.items.map((r) => (
              <RecommendationCard key={r.id} rec={r} photoId={photo.id} scene={scene} />
            ))}
          </ul>
        </section>
      ) : recs && !running ? (
        <EmptyState icon={<Sparkles className="size-6" />} title="No suggestions this time">
          Try again, maybe with a focus like “low maintenance” or “warmer at night”.
        </EmptyState>
      ) : !running && aiReady ? (
        <EmptyState icon={<Sparkles className="size-6" />} title="What could this space become?">
          Mode looks at the architecture, what's worth keeping and your idea board, then suggests changes that fit — each one a click from your brief.
        </EmptyState>
      ) : null}
    </div>
  );
}

function RecommendationCard({ rec, photoId, scene }: { rec: Recommendation; photoId: string; scene: SceneMap | undefined }) {
  const health = useStore((s) => s.health);
  const blocker = generationBlocker({ health });
  const [starting, setStarting] = useState(false);
  const meta = RECOMMENDATION_META[rec.category] ?? RECOMMENDATION_META.other;
  const CategoryIcon = meta.icon;
  const zones = useMemo(() => {
    const byId = new Map((scene?.zones ?? []).map((z) => [z.id, z]));
    return rec.targetZoneIds.map((id) => byId.get(id)).filter((z): z is NonNullable<typeof z> => !!z);
  }, [rec.targetZoneIds, scene]);
  const def = rec.elementType ? getElementDef(rec.elementType) : undefined;
  const ElIcon = def ? elementIcon(def.icon) : null;
  const focus = (id: string | null) => useStore.getState().setStudio({ focusZoneId: id });

  return (
    <li className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <CategoryIcon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">{meta.label}</p>
          <h3 className="text-sm font-medium leading-snug text-text">{rec.title}</h3>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted">{rec.why}</p>
      <p className="rounded-lg bg-surface-2 px-2.5 py-2 text-xs leading-relaxed text-text">{rec.prompt}</p>
      {(zones.length > 0 || def) && (
        <div className="flex flex-wrap gap-1.5">
          {def && ElIcon && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
              <ElIcon className="size-3" aria-hidden />
              {def.label}
            </span>
          )}
          {zones.map((z) => (
            <span
              key={z.id}
              onPointerEnter={() => focus(z.id)}
              onPointerLeave={() => focus(null)}
              className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
            >
              {z.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-0.5">
        <Button size="sm" className="max-lg:h-9" icon={<Plus className="size-3.5" />} onClick={() => addRecommendationToBrief(photoId, rec)}>
          Add to brief
        </Button>
        <Button
          size="sm"
          className="max-lg:h-9"
          variant="primary"
          icon={<ArrowRight className="size-3.5" />}
          loading={starting}
          disabled={!!blocker}
          title={blocker ?? 'Generate variations of this suggestion now'}
          onClick={async () => {
            setStarting(true);
            try {
              await generateRecommendation(photoId, rec);
            } finally {
              setStarting(false);
            }
          }}
        >
          Generate now
        </Button>
      </div>
    </li>
  );
}
