/**
 * What the Studio panels do, outside React: brief edits (store.updateDraft),
 * AI calls (tailored options, suggestions) run as cancellable jobs, runs
 * (generate, compare, re-run), scene map edits and "Refine outline" (a zone's
 * polygon becomes a Fine-tune surface whose mask the zone then shares).
 */
import type { ElementOptionsRequest } from '../../../../shared/api';
import { SPACE_TYPE_LABELS, emptyBrief, type DesignBrief, type Photo, type Recommendation, type Space } from '../../../../shared/types';
import { copyMaskInto, fillPolygon, isMaskEmpty } from '../../../engine/mask';
import type { Mask } from '../../../engine/types';
import { fetchElementOptions, fetchRecommendations, locationForApi } from '../../../lib/studio';
import * as runtime from '../../../state/runtime';
import { findPhoto, findVariation, selectActivePhoto, useStore } from '../../../state/store';
import { errorText } from '../../shell/format';
import { requestSceneAnalysis } from '../../shell/sceneJobs';
import { sceneSummaryText, startRun, type StartRunOptions } from '../generate';
import { AI_OFF_REASON, SERVER_OFFLINE_REASON } from './aiErrors';
import { runAiJob } from './aiJobs';
import { briefFromRecommendation, forgetSceneIds, mergeRecommendation, replaceDimensions } from './briefOps';
import { aiImageOf, climateForAi, elementFactory, ideaLines, showPhotoOnMobile } from './context';
import { isDesignZone, zoneSurface } from './zones';

const state = () => useStore.getState();

function photoAndSpace(photoId: string): { photo: Photo; space: Space } | undefined {
  return findPhoto(state().project, photoId);
}

// ---------------------------------------------------------------------------
// Brief edits
// ---------------------------------------------------------------------------

/** A discrete brief edit (its own undo step). */
export function editBrief(photoId: string, recipe: (brief: DesignBrief) => void): void {
  state().updateDraft(photoId, recipe as Parameters<ReturnType<typeof state>['updateDraft']>[1], {});
}

/** A text edit typed into the brief (merged into one undo step while typing). */
export function typeBrief(photoId: string, key: string, recipe: (brief: DesignBrief) => void): void {
  state().updateDraft(photoId, recipe as Parameters<ReturnType<typeof state>['updateDraft']>[1], { coalesce: `brief:${photoId}:${key}` });
}

/** Adds a design element (defaults, zones preselected from the scene, plant feasibility) and expands it. */
export function addElement(photoId: string, type: Parameters<ReturnType<typeof elementFactory>>[0]): string | null {
  const s = state();
  const found = photoAndSpace(photoId);
  if (!found || !s.project) return null;
  const spec = elementFactory(found.photo.scene, s.project.location, found.space.kind)(type);
  editBrief(photoId, (b) => void b.elements.push(spec));
  s.setStudio({ activeElementId: spec.id });
  return spec.id;
}

// ---------------------------------------------------------------------------
// AI: tailored options
// ---------------------------------------------------------------------------

export const tailorJobKey = (elementId: string) => `tailor:${elementId}`;

function sceneTextFor(photo: Photo, space: Space): string {
  return photo.scene ? sceneSummaryText(photo.scene) : `${SPACE_TYPE_LABELS[space.type]} (${space.kind}) photo. The scene hasn't been mapped yet.`;
}

/** Asks the AI for options tailored to this photo and merges them into the element (AI options first). */
export function tailorElement(photoId: string, elementId: string, ask?: string): void {
  const el = photoAndSpace(photoId)?.photo.draft?.elements.find((e) => e.id === elementId);
  void runAiJob(
    tailorJobKey(elementId),
    async (signal) => {
      const s = state();
      const found = photoAndSpace(photoId);
      const element = found?.photo.draft?.elements.find((e) => e.id === elementId);
      if (!found || !element || !s.project) throw new Error('That element is no longer in the brief.');
      const { photo, space } = found;
      const viewing = s.selection.photoId === photoId ? s.studio.viewVariationId : null;
      const { dataUrl } = await aiImageOf(photo, viewing);
      const zoneLabel = new Map((photo.scene?.zones ?? []).map((z) => [z.id, z.label]));
      const pathLabel = new Map((photo.scene?.paths ?? []).map((p) => [p.id, p.label]));
      const req: ElementOptionsRequest = {
        elementType: element.type,
        elementLabel: element.label,
        image: dataUrl,
        sceneSummary: sceneTextFor(photo, space),
        zoneLabels: [...element.zoneIds.map((id) => zoneLabel.get(id)), ...element.pathIds.map((id) => pathLabel.get(id))].filter((l): l is string => !!l),
        ideas: ideaLines(s.project, photo.draft ?? emptyBrief(), space.id),
        location: locationForApi(s.project.location),
        climate: climateForAi(s.project.location),
        existing: element.dimensions.map((d) => ({ id: d.id, label: d.label, optionLabels: d.options.map((o) => o.label) })),
        ask: ask?.trim() ? ask.trim().slice(0, 1000) : null,
      };
      const result = await fetchElementOptions(req, signal, element.dimensions);
      if (signal.aborted) return result;
      const still = photoAndSpace(photoId)?.photo.draft?.elements.some((e) => e.id === elementId);
      if (!still) return result;
      editBrief(photoId, (b) => {
        const target = b.elements.find((e) => e.id === elementId);
        if (target) replaceDimensions(target, result.dimensions);
      });
      state().notify(`New options for ${element.label} — tailored to your photo.`, 'success');
      return result;
    },
    {
      label: `Tailoring ${el?.label ?? 'the'} options to your photo…`,
      what: 'tailor the options',
      info: (r) => r.tips.filter((t) => t.trim()).slice(0, 6),
      toastErrors: () => state().studio.panel !== 'design',
    },
  );
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function start(opts: StartRunOptions): Promise<string | null> {
  try {
    const id = await startRun(opts);
    showPhotoOnMobile();
    return id;
  } catch (err) {
    state().notify(errorText(err), 'error');
    return null;
  }
}

/** Generates N variations of the photo's brief (count from studio.variationCount). */
export function generateBrief(photoId: string): Promise<string | null> {
  return start({ photoId, mode: 'variations' });
}

/** One variation per option of a dimension, everything else fixed. */
export function compareOptions(photoId: string, elementId: string, dimensionId: string, optionIds: string[]): Promise<string | null> {
  return start({ photoId, mode: 'compare', compare: { elementId, dimensionId, optionIds } });
}

/** Runs a past generation's brief again (same mode, compared options and starting image when it still exists). */
export function rerunGeneration(photoId: string, generationId: string): Promise<string | null> {
  const photo = photoAndSpace(photoId)?.photo;
  const g = photo?.generations.find((x) => x.id === generationId);
  if (!photo || !g) return Promise.resolve(null);
  const baseVariationId = g.baseVariationId && findVariation(photo, g.baseVariationId) ? g.baseVariationId : null;
  return start({
    photoId,
    mode: g.mode,
    ...(g.compare ? { compare: g.compare } : {}),
    brief: structuredClone(g.brief),
    baseVariationId,
  });
}

/** Replaces the photo's draft brief with a past run's brief (undoable). */
export function restoreBrief(photoId: string, generationId: string): void {
  const g = photoAndSpace(photoId)?.photo.generations.find((x) => x.id === generationId);
  if (!g) return;
  const copy = structuredClone(g.brief);
  editBrief(photoId, (b) => void Object.assign(b, copy));
  state().setStudio({ panel: 'design', activeElementId: null });
  state().notify('Brief restored — adjust it on the Design tab and generate again.', 'success');
}

export function viewVariation(variationId: string | null): void {
  state().setStudio({ viewVariationId: variationId, gridGenerationId: null });
  showPhotoOnMobile();
}

export function openRunGrid(generationId: string): void {
  state().setStudio({ gridGenerationId: generationId });
  showPhotoOnMobile();
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export const suggestionsJobKey = (photoId: string) => `recommend:${photoId}`;

/** Asks the AI for recommendations for the photo (or the variation shown) and stores them on the photo. */
export function fetchSuggestions(photoId: string, focus: string): void {
  void runAiJob(
    suggestionsJobKey(photoId),
    async (signal) => {
      const s = state();
      const found = photoAndSpace(photoId);
      if (!found || !s.project) throw new Error('That photo is no longer in this project.');
      const { photo, space } = found;
      const viewing = s.selection.photoId === photoId ? s.studio.viewVariationId : null;
      const { dataUrl, baseVariationId } = await aiImageOf(photo, viewing);
      const items = await fetchRecommendations(
        {
          image: dataUrl,
          sceneSummary: sceneTextFor(photo, space),
          zones: (photo.scene?.zones ?? []).filter(isDesignZone).map((z) => ({ id: z.id, kind: z.kind, label: z.label })),
          ideas: ideaLines(s.project, photo.draft ?? emptyBrief(), space.id),
          location: locationForApi(s.project.location),
          climate: climateForAi(s.project.location),
          focus: focus.trim() ? focus.trim().slice(0, 1000) : null,
        },
        signal,
      );
      if (signal.aborted || !photoAndSpace(photoId)) return items;
      const now = state();
      now.setRecommendations(photoId, items, baseVariationId);
      if (now.studio.panel !== 'suggestions' || now.selection.photoId !== photoId) {
        now.notify(`${items.length} suggestion${items.length === 1 ? '' : 's'} ready on the Suggest tab.`, 'success');
      }
      return items;
    },
    {
      label: 'Thinking up ideas for this photo…',
      what: 'get suggestions',
      toastErrors: () => state().studio.panel !== 'suggestions',
    },
  );
}

/** Adds a recommendation to the brief (prompt, target zones, element). */
export function addRecommendationToBrief(photoId: string, rec: Recommendation): void {
  const s = state();
  const found = photoAndSpace(photoId);
  if (!found || !s.project) return;
  const make = elementFactory(found.photo.scene, s.project.location, found.space.kind);
  let result: ReturnType<typeof mergeRecommendation> | null = null;
  editBrief(photoId, (b) => {
    result = mergeRecommendation(b, rec, make);
  });
  const r = result as ReturnType<typeof mergeRecommendation> | null;
  if (r?.elementId) s.setStudio({ activeElementId: r.elementId });
  s.notify(
    r && !r.promptAdded && !r.elementAdded ? `“${rec.title}” is already in your brief.` : `Added “${rec.title}” to your brief — fine-tune it on the Design tab.`,
    'success',
  );
}

/** Generates a recommendation as is (keeping the brief's plant maturity and idea picks). */
export function generateRecommendation(photoId: string, rec: Recommendation): Promise<string | null> {
  const s = state();
  const found = photoAndSpace(photoId);
  if (!found || !s.project) return Promise.resolve(null);
  const make = elementFactory(found.photo.scene, s.project.location, found.space.kind);
  return start({ photoId, mode: 'variations', brief: briefFromRecommendation(rec, found.photo.draft, make) });
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Queues scene mapping (re-mapping when `force`). Explains why when it can't start. */
export async function mapScene(photoId: string, force = false): Promise<void> {
  if (requestSceneAnalysis(photoId, { force })) return;
  const s = state();
  if (!s.health) {
    await s.refreshHealth();
    if (requestSceneAnalysis(photoId, { force })) return;
  }
  const h = state().health;
  if (!h?.ok) state().notify(SERVER_OFFLINE_REASON, 'error');
  else if (!h.ai.enabled) state().notify(AI_OFF_REASON, 'error');
  // Otherwise it is already queued or running.
}

/** Deletes a zone and every reference to it in the photo's brief (one undo step). */
export function deleteZone(photoId: string, zoneId: string): void {
  const s = state();
  s.mutateProject('Delete area', (d) => {
    for (const sp of d.spaces) {
      const ph = sp.photos.find((p) => p.id === photoId);
      if (!ph) continue;
      if (ph.scene) ph.scene.zones = ph.scene.zones.filter((z) => z.id !== zoneId);
      if (ph.draft) forgetSceneIds(ph.draft, { zoneIds: [zoneId] });
    }
  });
  if (s.studio.focusZoneId === zoneId) s.setStudio({ focusZoneId: null });
}

export function deletePath(photoId: string, pathId: string): void {
  state().mutateProject('Delete path', (d) => {
    for (const sp of d.spaces) {
      const ph = sp.photos.find((p) => p.id === photoId);
      if (!ph) continue;
      if (ph.scene) ph.scene.paths = ph.scene.paths.filter((p) => p.id !== pathId);
      if (ph.draft) forgetSceneIds(ph.draft, { pathIds: [pathId] });
    }
  });
}

function openFineTune(regionId: string, message: string): void {
  const s = state();
  s.setMode('finetune');
  s.setPanel('surfaces');
  s.select({ regionId, objectId: null, lightId: null });
  s.setTool('smart-brush');
  showPhotoOnMobile();
  s.notify(message, 'success');
}

/**
 * "Refine outline": turns a zone into a Fine-tune surface whose mask is
 * seeded from the zone's polygon (or its earlier refined outline) and shared
 * with the zone (zone.maskId), so brush / wand edits in Fine-tune refine the
 * area the Studio changes. Switches to Fine-tune with that surface selected.
 */
export async function refineZoneOutline(photoId: string, zoneId: string): Promise<void> {
  let s = state();
  if (s.selection.photoId !== photoId) s.selectPhoto(photoId);
  s = state();
  const photo = selectActivePhoto(s);
  const zone = photo?.scene?.zones.find((z) => z.id === zoneId);
  if (!photo || !zone) return;

  const linked = zone.maskId ? photo.regions.find((r) => r.maskId === zone.maskId) : undefined;
  if (linked) {
    openFineTune(linked.id, `Editing the outline of “${linked.name}”. Brush, wand and eraser edits apply to the Studio area too.`);
    return;
  }

  // The zone was refined before but its surface was deleted: start from that outline.
  let previous: Mask | undefined;
  if (zone.maskId) {
    try {
      previous = await runtime.loadMask(zone.maskId, photo.width, photo.height);
    } catch {
      previous = undefined;
    }
  }
  s = state();
  if (selectActivePhoto(s)?.id !== photo.id) return;
  const regionId = s.addRegion(zoneSurface(zone.kind), zone.label);
  if (!regionId) return;
  const region = selectActivePhoto(state())?.regions.find((r) => r.id === regionId);
  const mask = region ? runtime.getMask(region.maskId) : undefined;
  if (!region || !mask) return;
  if (previous && !isMaskEmpty(previous) && previous.width === mask.width && previous.height === mask.height) copyMaskInto(mask, previous);
  else fillPolygon(mask, zone.polygon, 'add');
  runtime.markMaskDirty(region.maskId);
  state().updateScene(
    photoId,
    (sc) => {
      const z = sc.zones.find((x) => x.id === zoneId);
      if (z) z.maskId = region.maskId;
    },
    {},
  );
  openFineTune(regionId, `“${zone.label}” is now a Fine-tune surface. Refine its outline with the brush, wand or eraser — Studio runs use your outline.`);
}
