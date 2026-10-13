/**
 * Automatic scene mapping: when a new photo lands in the open project (from
 * any upload path) and AI is enabled, analyze it in the background
 * (analyzeScene → store.setScene). Never blocks the UI; failures become a
 * toast with a pointer to the Scene tab. Also used by the sidebar's
 * "Map scene" / "Re-map scene" photo action.
 */
import { create } from 'zustand';
import type { Photo, Project } from '../../../shared/types';
import { ApiError, isAbortError } from '../../lib/api';
import { analyzeScene } from '../../lib/studio';
import * as db from '../../state/persistence';
import { findPhoto, useStore } from '../../state/store';
import { errorText } from './format';

export type SceneJobStatus = 'queued' | 'running';

interface SceneJobsState {
  jobs: Record<string, SceneJobStatus>;
}

export const useSceneJobs = create<SceneJobsState>()(() => ({ jobs: {} }));

/** Status of the background scene mapping of a photo (undefined = idle). */
export function useSceneJob(photoId: string | null | undefined): SceneJobStatus | undefined {
  return useSceneJobs((s) => (photoId ? s.jobs[photoId] : undefined));
}

const MAX_CONCURRENT = 2;

interface QueuedJob {
  photoId: string;
  projectId: string;
  /** Replace an existing scene map (explicit re-map). */
  force: boolean;
}

const queue: QueuedJob[] = [];
const controllers = new Map<string, AbortController>();
let running = 0;

function setJob(photoId: string, status: SceneJobStatus | null) {
  useSceneJobs.setState((s) => {
    const jobs = { ...s.jobs };
    if (status) jobs[photoId] = status;
    else delete jobs[photoId];
    return { jobs };
  });
}

/** Queue a scene analysis for a photo of the open project. Returns false if AI is off or it's already queued. */
export function requestSceneAnalysis(photoId: string, opts: { force?: boolean } = {}): boolean {
  const s = useStore.getState();
  const projectId = s.project?.id;
  if (!projectId || !s.health?.ai.enabled) return false;
  if (useSceneJobs.getState().jobs[photoId]) return false;
  queue.push({ photoId, projectId, force: !!opts.force });
  setJob(photoId, 'queued');
  pump();
  return true;
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    running++;
    void run(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(job: QueuedJob): Promise<void> {
  const { photoId, projectId, force } = job;
  const store = useStore.getState();
  const found = store.project?.id === projectId ? findPhoto(store.project, photoId) : undefined;
  if (!found || (found.photo.scene && !force)) {
    setJob(photoId, null);
    return;
  }
  const controller = new AbortController();
  controllers.set(photoId, controller);
  setJob(photoId, 'running');
  const { photo, space } = found;
  try {
    const blob = await db.getBlob(photo.imageId);
    if (!blob) throw new Error('the photo is missing from storage');
    const scene = await analyzeScene(photo, blob, {
      spaceTypeHint: space.type,
      notes: space.notes?.trim() || null,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    const now = useStore.getState();
    const current = now.project?.id === projectId ? findPhoto(now.project, photoId) : undefined;
    if (!current) return; // project closed or photo deleted meanwhile
    if (current.photo.scene && !force) return; // mapped from the Scene tab meanwhile
    now.setScene(photoId, scene);
    if (now.selection.photoId === photoId) {
      const n = scene.zones.length;
      now.notify(`Scene mapped — ${n} area${n === 1 ? '' : 's'} found. See the Scene tab for details.`, 'success');
    }
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) return;
    const s = useStore.getState();
    if (err instanceof ApiError && err.code === 'ai_disabled') {
      void s.refreshHealth();
      return;
    }
    if (s.project?.id !== projectId) return;
    s.notify(`Couldn't map the scene of “${photo.name}”: ${errorText(err)} You can retry from the Scene tab.`, 'error');
  } finally {
    controllers.delete(photoId);
    setJob(photoId, null);
  }
}

function cancelAll() {
  queue.length = 0;
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  useSceneJobs.setState({ jobs: {} });
}

function photosOf(project: Project | null): Photo[] {
  return project ? project.spaces.flatMap((sp) => sp.photos) : [];
}

let installed = false;

/** Watches the store for newly added photos. Idempotent. */
export function installAutoSceneAnalysis(): void {
  if (installed) return;
  installed = true;
  let projectId: string | null = null;
  let known = new Set<string>();
  /** New photos that arrived before /api/health answered. */
  let waiting: string[] = [];

  const enqueue = (ids: string[]) => {
    const st = useStore.getState();
    if (!st.health) {
      waiting.push(...ids);
      return;
    }
    if (!st.health.ai.enabled) return;
    for (const id of ids) requestSceneAnalysis(id);
  };

  useStore.subscribe((s, prev) => {
    const pid = s.project?.id ?? null;
    if (pid !== projectId) {
      // Opened / closed / switched project: existing photos are not "new".
      cancelAll();
      projectId = pid;
      known = new Set(photosOf(s.project).map((p) => p.id));
      waiting = [];
      return;
    }
    if (s.project !== prev.project) {
      const fresh: string[] = [];
      for (const ph of photosOf(s.project)) {
        if (known.has(ph.id)) continue;
        known.add(ph.id);
        if (!ph.scene) fresh.push(ph.id);
      }
      if (fresh.length) enqueue(fresh);
    }
    if (s.health !== prev.health && s.health && waiting.length) {
      const ids = waiting;
      waiting = [];
      enqueue(ids);
    }
  });
}
