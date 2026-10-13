/**
 * What the Studio panels work on (active project / space / photo / brief) and
 * the inputs they send to the AI: the starting image as a data URL, idea
 * board lines, climate text, and new element specs with plant feasibility.
 */
import {
  emptyBrief,
  type DesignBrief,
  type ElementSpec,
  type ElementType,
  type Photo,
  type Project,
  type ProjectLocation,
  type SceneMap,
  type Space,
} from '../../../../shared/types';
import { feasibilityContext, getTheme, newElementSpec } from '../../../assets/design';
import { blobToAIDataUrl } from '../../../lib/imageImport';
import { useInvasivesReady } from '../../../site/hooks';
import * as db from '../../../state/persistence';
import { findVariation, selectActivePhoto, selectActiveSpace, useStore } from '../../../state/store';
import { isDesktopViewport } from '../../shell/hooks';
import { climateText, ideaText, ideasForBrief } from '../planRequest';

const EMPTY_BRIEF: DesignBrief = emptyBrief();

export interface StudioContext {
  project: Project | null;
  space: Space | undefined;
  photo: Photo | undefined;
  scene: SceneMap | undefined;
  /** The photo's draft brief (an empty brief when none exists yet). */
  brief: DesignBrief;
  setting: 'interior' | 'exterior';
  /**
   * True once the US-RIIS invasive list has loaded (it starts loading when a
   * panel mounts). Plant ratings memoized from this context list it as a
   * dependency so invasive flags appear as soon as the list arrives.
   */
  invasivesReady: boolean;
}

export function useStudioContext(): StudioContext {
  const project = useStore((s) => s.project);
  const space = useStore(selectActiveSpace);
  const photo = useStore(selectActivePhoto);
  const invasivesReady = useInvasivesReady();
  return {
    project,
    space,
    photo,
    scene: photo?.scene,
    brief: photo?.draft ?? EMPTY_BRIEF,
    setting: space?.kind ?? 'exterior',
    invasivesReady,
  };
}

// ---------------------------------------------------------------------------
// AI inputs
// ---------------------------------------------------------------------------

const imageCache = new Map<string, Promise<string>>();
const IMAGE_CACHE_MAX = 4;

/**
 * The image the next run starts from (the variation shown in the viewer, else
 * the original photo) as a downscaled JPEG data URL for Claude. Cached per
 * blob id.
 */
export async function aiImageOf(photo: Photo, variationId: string | null | undefined): Promise<{ dataUrl: string; baseVariationId?: string }> {
  const variation = variationId ? findVariation(photo, variationId) : undefined;
  const imageId = variation?.imageId ?? photo.imageId;
  let pending = imageCache.get(imageId);
  if (!pending) {
    pending = (async () => {
      const blob = await db.getBlob(imageId);
      if (!blob) {
        throw new Error(variation ? 'The variation shown is missing from storage — switch back to the original photo.' : `Photo “${photo.name}” is missing from storage.`);
      }
      return blobToAIDataUrl(blob);
    })();
    imageCache.set(imageId, pending);
    pending.catch(() => imageCache.delete(imageId));
    if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value as string);
  }
  return { dataUrl: await pending, ...(variation ? { baseVariationId: variation.id } : {}) };
}

/** One line per idea the brief draws on (for element options / recommendations). */
export function ideaLines(project: Project | null, brief: DesignBrief, spaceId: string | null): string[] {
  if (!project) return [];
  return ideasForBrief(project.ideaBoard, brief, spaceId)
    .map((i) => ideaText(i, getTheme))
    .filter((t) => t.trim())
    .slice(0, 12);
}

export function climateForAi(location: ProjectLocation | undefined): string | null {
  return climateText(location);
}

/** Factory for new brief elements: default choices, zones preselected from the scene, plant feasibility for the property. */
export function elementFactory(scene: SceneMap | undefined, location: ProjectLocation | undefined, setting: 'interior' | 'exterior'): (type: ElementType) => ElementSpec {
  const ctx = feasibilityContext(location, [], setting);
  return (type) => newElementSpec(type, scene, ctx);
}

/** After starting something that shows on the photo, bring the photo into view on phones (one pane at a time). */
export function showPhotoOnMobile(): void {
  if (typeof window !== 'undefined' && !isDesktopViewport()) useStore.getState().setView({ mobilePane: 'editor' });
}
