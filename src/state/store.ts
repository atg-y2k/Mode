/**
 * Application store (zustand + immer).
 *
 * - `project` is the active Project document. All edits go through
 *   `mutateProject`, which records undo history (immer gives structural
 *   sharing, so snapshots are cheap) and schedules a debounced save.
 * - Pixel data lives in ./runtime (masks, decoded photos) and ./persistence.
 * - UI state (selection, tool, panel, view) lives here too so the editor
 *   canvas and the side panels stay in sync.
 */
import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import type { HealthResponse, ImageProviderId } from '../../shared/api';
import { newId } from '../../shared/ids';
import {
  DEFAULT_LIGHTING,
  SPACE_TYPE_LABELS,
  SURFACE_LABELS,
  emptyBrief,
  spaceKindOf,
  type AIRender,
  type AssetCategory,
  type AssetDef,
  type Calibration,
  type Design,
  type DesignBrief,
  type Generation,
  type IdeaItem,
  type LightBeam,
  type LightingSettings,
  type Photo,
  type PlacedLight,
  type PlacedObject,
  type Project,
  type ProjectMeta,
  type Recommendation,
  type Region,
  type SceneMap,
  type Space,
  type SpaceAnalysis,
  type SpaceType,
  type SurfaceKind,
  type Treatment,
  type Variation,
} from '../../shared/types';
import { findAsset } from '../assets/catalog';
import { evictAssetImage } from '../engine/assetImages';
import { copyMaskInto, createMask, type MaskMode } from '../engine/mask';
import { getHealth } from '../lib/api';
import { downloadBlob, importImageFile } from '../lib/imageImport';
import * as db from './persistence';
import * as runtime from './runtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolId =
  | 'select' // select / move objects & lights
  | 'pan'
  | 'brush' // paint region mask
  | 'eraser' // erase region mask
  | 'smart-brush' // color-aware brush
  | 'wand' // magic wand
  | 'polygon' // click points, close to fill
  | 'lasso' // freehand outline
  | 'eyedropper' // pick a color from the photo -> pickedColor
  | 'calibrate' // draw a line of known length
  | 'plane' // edit the region's perspective quad
  | 'place'; // click to place `placement`

/** Studio = prompt-driven design (main); Fine-tune = hand tools on the canvas (secondary). */
export type WorkspaceMode = 'studio' | 'finetune';

/** Right-panel tabs in Fine-tune mode. */
export type PanelId = 'surfaces' | 'paint' | 'materials' | 'lighting' | 'library';

/** Right-panel tabs in Studio mode. */
export type StudioPanelId = 'design' | 'scene' | 'ideas' | 'suggestions' | 'history';

export interface StudioState {
  panel: StudioPanelId;
  /** Variation shown in the viewer (null = original photo). It is also the base of the next run. */
  viewVariationId: string | null;
  /** When set, the center shows this generation as a comparison grid. */
  gridGenerationId: string | null;
  /** Draw zone outlines & labels over the image. */
  showZones: boolean;
  /** Zone highlighted (hover / selected in the Scene panel). */
  focusZoneId: string | null;
  /** Sketch tool in the viewer: draw a path (centerline) or an area to target. */
  sketch: 'none' | 'path' | 'area';
  /** Variations per run (1..6). */
  variationCount: number;
  /**
   * How runs render: 'handoff' = the user pastes each prepared image + prompt into
   * the ChatGPT or Gemini app (their subscription) and brings the result back;
   * 'api' = an image API key configured on the server renders automatically.
   */
  renderMode: 'handoff' | 'api';
  /** Consumer app for manual hand-offs. */
  handoffApp: 'chatgpt' | 'gemini';
  /** Image provider for the next run (null = server default). */
  provider: ImageProviderId | null;
  quality: 'draft' | 'standard' | 'high';
  /** Element card expanded in the Design panel. */
  activeElementId: string | null;
}

export interface RunProgress {
  stage: 'planning' | 'rendering';
  total: number;
  done: number;
  failed: number;
}

/** Opens the "Find real products" modal (Home Depot / Lowe's / nurseries) prefilled. */
export interface ShopRequest {
  query: string;
  category: AssetCategory;
}

export interface ToolOptions {
  brushRadius: number; // px in photo space
  brushHardness: number; // 0..1
  /** For brush / smart brush / polygon / lasso / wand: add to or subtract from the region. */
  maskMode: MaskMode;
  wandTolerance: number; // ΔE
  wandContiguous: boolean;
  smartTolerance: number; // ΔE
}

export type Placement =
  | { kind: 'object'; assetId: string }
  | { kind: 'light'; assetId?: string; name: string; beam: LightBeam; kelvin: number }
  | null;

export interface Selection {
  spaceId: string | null;
  photoId: string | null;
  regionId: string | null;
  objectId: string | null;
  lightId: string | null;
}

export interface ViewState {
  /** Before/after comparison mode in the editor. */
  compare: 'off' | 'slider' | 'split';
  /** Tint region masks in the editor. 'selected' = only the selected region. */
  masks: 'all' | 'selected' | 'none';
  /** Temporarily show the untouched photo (press-and-hold). */
  showOriginal: boolean;
  /** Mobile: which pane is visible. */
  mobilePane: 'spaces' | 'editor' | 'panel';
}

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
}

type HistoryEntry =
  | { kind: 'project'; label: string; before: Project; after: Project; key?: string; at: number }
  | { kind: 'mask'; label: string; maskId: string; before: Uint8Array; after: Uint8Array; at: number };

export interface MutateOptions {
  /** Merge with the previous history entry if it has the same key and is < 1.5s old (sliders, drags). */
  coalesce?: string;
  /** Default true. */
  history?: boolean;
}

export interface AppState {
  ready: boolean;
  projects: ProjectMeta[];
  project: Project | null;
  /** User-uploaded and AI-generated assets (global, all projects). */
  library: AssetDef[];
  mode: WorkspaceMode;
  studio: StudioState;
  /** In-flight Studio runs by generation id. */
  runs: Record<string, RunProgress>;
  selection: Selection;
  tool: ToolId;
  toolOptions: ToolOptions;
  placement: Placement;
  panel: PanelId;
  view: ViewState;
  /** Bumped on every in-place mask change; drives re-rendering. */
  maskVersions: Record<string, number>;
  /** Last color picked with the eyedropper. */
  pickedColor: string | null;
  health: HealthResponse | null;
  /** Non-null while the Shop modal is open. */
  shop: ShopRequest | null;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  /**
   * Why this tab doesn't save the open project: it is open for editing in
   * another tab, or another tab saved it after this copy was loaded. Edits
   * here stay in memory until takeOver().
   */
  readOnly: null | 'other-tab' | 'stale';
  toasts: Toast[];
  past: HistoryEntry[];
  future: HistoryEntry[];

  // lifecycle / projects
  init(): Promise<void>;
  refreshHealth(): Promise<void>;
  createProject(name: string): Promise<string>;
  openProject(id: string): Promise<void>;
  closeProject(): Promise<void>;
  deleteProject(id: string): Promise<void>;
  updateProjectInfo(patch: Partial<Pick<Project, 'name' | 'location' | 'budget' | 'style'>>): void;
  exportProject(): Promise<void>;
  importProject(file: Blob): Promise<void>;
  /** Make this tab the one that saves the open project: takes it over from another tab and reloads the stored copy. */
  takeOver(): Promise<void>;

  // spaces & photos
  addSpace(type: SpaceType, name?: string): string;
  updateSpace(id: string, patch: Partial<Pick<Space, 'name' | 'type' | 'notes'>>): void;
  deleteSpace(id: string): Promise<void>;
  addPhotos(spaceId: string, files: File[]): Promise<string[]>;
  renamePhoto(photoId: string, name: string): void;
  deletePhoto(photoId: string): Promise<void>;
  setCalibration(photoId: string, calibration: Calibration | undefined): void;
  setAnalysis(photoId: string, analysis: SpaceAnalysis | undefined): void;

  // regions (active photo)
  addRegion(surface: SurfaceKind, name?: string): string | null;
  updateRegion(regionId: string, patch: Partial<Omit<Region, 'id' | 'maskId' | 'createdAt'>>, opts?: MutateOptions): void;
  deleteRegion(regionId: string): void;
  moveRegion(regionId: string, direction: -1 | 1): void;

  // designs (active photo / active design)
  addDesign(name?: string, copyActive?: boolean): string | null;
  renameDesign(designId: string, name: string): void;
  deleteDesign(designId: string): void;
  setActiveDesign(designId: string): void;
  setTreatment(regionId: string, treatment: Treatment | null, opts?: MutateOptions): void;
  toggleRegionHidden(regionId: string): void;
  updateLighting(patch: Partial<LightingSettings>, opts?: MutateOptions): void;
  addObject(obj: Omit<PlacedObject, 'id' | 'z'> & { z?: number }): string | null;
  updateObject(id: string, patch: Partial<Omit<PlacedObject, 'id'>>, opts?: MutateOptions): void;
  deleteObject(id: string): void;
  duplicateObject(id: string): string | null;
  reorderObject(id: string, to: 'front' | 'back' | 'forward' | 'backward'): void;
  addLight(light: Omit<PlacedLight, 'id'>): string | null;
  updateLight(id: string, patch: Partial<Omit<PlacedLight, 'id'>>, opts?: MutateOptions): void;
  deleteLight(id: string): void;
  addAIRender(blob: Blob, prompt: string, provider: string): Promise<string | null>;
  deleteAIRender(renderId: string): void;
  updateDesignNotes(notes: string): void;

  // studio
  setMode(mode: WorkspaceMode): void;
  setStudio(patch: Partial<StudioState>): void;
  /** Replace the AI scene map of a photo (undoable). */
  setScene(photoId: string, scene: SceneMap | undefined): void;
  /** Edit zones / paths of a photo's scene (no-op when the photo has no scene). */
  updateScene(photoId: string, recipe: (scene: Draft<SceneMap>) => void, opts?: MutateOptions): void;
  /** Edit the Studio brief of a photo (created empty on first edit). */
  updateDraft(photoId: string, recipe: (brief: Draft<DesignBrief>) => void, opts?: MutateOptions): void;
  addIdeaItem(item: Omit<IdeaItem, 'id' | 'createdAt'>, blobs?: { image?: Blob; thumb?: Blob }): Promise<string | null>;
  updateIdeaItem(id: string, patch: Partial<Omit<IdeaItem, 'id'>>, opts?: MutateOptions): void;
  removeIdeaItem(id: string): Promise<void>;
  addGeneration(photoId: string, generation: Generation): void;
  updateGeneration(photoId: string, generationId: string, recipe: (g: Draft<Generation>) => void): void;
  /** Stores nothing in the blob store — save the variation's image/thumb blobs first. */
  addVariation(photoId: string, generationId: string, variation: Variation): void;
  toggleFavorite(photoId: string, variationId: string): void;
  /** Deletes a variation (false, with a message, while a pending hand-off run starts from it). */
  deleteVariation(photoId: string, variationId: string): Promise<boolean>;
  deleteGeneration(photoId: string, generationId: string): Promise<void>;
  setRecommendations(photoId: string, items: Recommendation[], baseVariationId?: string): void;
  setRunProgress(generationId: string, progress: RunProgress | null): void;

  // library
  addLibraryAsset(asset: AssetDef, imageBlob?: Blob): Promise<void>;
  updateLibraryAsset(id: string, patch: Partial<Omit<AssetDef, 'id'>>): Promise<void>;
  deleteLibraryAsset(id: string): Promise<void>;

  // ui
  select(patch: Partial<Selection>): void;
  selectSpace(spaceId: string): void;
  selectPhoto(photoId: string): void;
  setTool(tool: ToolId): void;
  setToolOptions(patch: Partial<ToolOptions>): void;
  setPlacement(p: Placement): void;
  setPanel(panel: PanelId): void;
  setView(patch: Partial<ViewState>): void;
  setPickedColor(hex: string | null): void;
  openShop(req?: Partial<ShopRequest>): void;
  closeShop(): void;
  notify(message: string, kind?: Toast['kind']): void;
  dismissToast(id: string): void;

  // history
  mutateProject(label: string, recipe: (draft: Draft<Project>) => void, opts?: MutateOptions): void;
  /** Record a mask edit (bytes before/after) so it can be undone. */
  recordMaskEdit(maskId: string, before: Uint8Array, after: Uint8Array, label?: string): void;
  undo(): void;
  redo(): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for panels / editor)
// ---------------------------------------------------------------------------

export const REGION_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595', '#94d82d', '#845ef7'];

export function findSpace(p: Project | null, spaceId: string | null): Space | undefined {
  if (!p || !spaceId) return undefined;
  return p.spaces.find((s) => s.id === spaceId);
}

export function findPhoto(p: Project | null, photoId: string | null): { space: Space; photo: Photo } | undefined {
  if (!p || !photoId) return undefined;
  for (const space of p.spaces) {
    const photo = space.photos.find((ph) => ph.id === photoId);
    if (photo) return { space, photo };
  }
  return undefined;
}

export function activeDesignOf(photo: Photo | undefined): Design | undefined {
  if (!photo) return undefined;
  return photo.designs.find((d) => d.id === photo.activeDesignId) ?? photo.designs[0];
}

/** Zones the user sketched (kept across scene re-analysis). */
export function isSketchZone(z: { source?: string; kind: string; label: string }): boolean {
  return z.source === 'sketch' || (z.kind === 'other' && z.label.startsWith('Sketched area'));
}

/** Every blob id and mask id owned by a photo (for cleanup on delete). */
export function photoRefs(photo: Photo): { blobIds: string[]; maskIds: string[] } {
  return db.photoReferencedIds(photo);
}

/**
 * Hand-off runs of a photo that start from `variationId` and still wait for
 * a result (or its review): deleting that variation would strand them —
 * their exports and imports need the starting image.
 */
export function pendingRunsFrom(photo: Photo, variationId: string): Generation[] {
  return photo.generations.filter((g) => g.baseVariationId === variationId && (g.planned ?? []).some((p) => p.status === 'awaiting-handoff' || p.status === 'staged'));
}

/** Variation by id within a photo. */
export function findVariation(photo: Photo | undefined, variationId: string | null): Variation | undefined {
  if (!photo || !variationId) return undefined;
  for (const g of photo.generations) {
    const v = g.variations.find((x) => x.id === variationId);
    if (v) return v;
  }
  return undefined;
}

export function newDesign(name: string): Design {
  const now = Date.now();
  return {
    id: newId('dsg'),
    name,
    createdAt: now,
    updatedAt: now,
    treatments: {},
    hiddenRegionIds: [],
    objects: [],
    lights: [],
    lighting: { ...DEFAULT_LIGHTING },
    aiRenders: [],
  };
}

export function newProject(name: string): Project {
  const now = Date.now();
  return {
    id: newId('prj'),
    version: 1,
    name: name.trim() || 'My home',
    createdAt: now,
    updatedAt: now,
    location: {},
    spaces: [],
    ideaBoard: [],
    assetList: [],
  };
}

function designLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

// Selectors ---------------------------------------------------------------

export const selectActiveSpace = (s: AppState): Space | undefined => findSpace(s.project, s.selection.spaceId);
export const selectActivePhoto = (s: AppState): Photo | undefined => findPhoto(s.project, s.selection.photoId)?.photo;
export const selectActiveDesign = (s: AppState): Design | undefined => activeDesignOf(selectActivePhoto(s));
export const selectSelectedRegion = (s: AppState): Region | undefined =>
  selectActivePhoto(s)?.regions.find((r) => r.id === s.selection.regionId);
export const selectSelectedObject = (s: AppState): PlacedObject | undefined =>
  selectActiveDesign(s)?.objects.find((o) => o.id === s.selection.objectId);
export const selectSelectedLight = (s: AppState): PlacedLight | undefined =>
  selectActiveDesign(s)?.lights.find((l) => l.id === s.selection.lightId);

/** Resolve a built-in or library asset by id. */
export function resolveAsset(id: string): AssetDef | undefined {
  return findAsset(id, useStore.getState().library);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 80;
const COALESCE_MS = 1500;
const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The open project this tab must not save: another tab holds its write lock,
 * or saved it after this copy was loaded (see AppState.readOnly).
 */
let readOnlyOf: string | null = null;
/** Save counter of each project's stored document as this tab last loaded or wrote it (see db.saveProject). */
const revs = new Map<string, number>();
/** Saves run one at a time, in order: each one checks the counter the previous one wrote. */
let saveChain: Promise<unknown> = Promise.resolve();
/** Release functions of the project write locks this tab holds. */
const heldLocks = new Map<string, () => void>();
/** Releases the shared storage lock held while a project is open (keeps other tabs' startup sweep away). */
let releaseStorageLock: (() => void) | null = null;

/**
 * Pixel data that may have lost its last reference (undo history thrown away,
 * deleted photos / spaces / runs / ideas), per project. It is deleted after the
 * next successful save, and only what neither the saved document, the open
 * document, its undo history nor the library still references.
 */
const cleanupQueue = new Map<string, { blobIds: Set<string>; maskIds: Set<string> }>();

/** referencedIds per immutable document snapshot (history entries share most of them). */
const refCache = new WeakMap<Project, { blobIds: string[]; maskIds: string[] }>();
function refsOf(p: Project): { blobIds: string[]; maskIds: string[] } {
  let r = refCache.get(p);
  if (!r) refCache.set(p, (r = db.referencedIds(p)));
  return r;
}

function lockManager(): LockManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.locks : undefined;
}

type ChannelMessage = { type: 'saved'; id: string; meta: ProjectMeta } | { type: 'deleted'; id: string };

/** Mutate the active design of the active photo. */
function withActiveDesign(draft: Draft<Project>, photoId: string | null, fn: (d: Draft<Design>, ph: Draft<Photo>) => void) {
  if (!photoId) return;
  for (const space of draft.spaces) {
    const ph = space.photos.find((p) => p.id === photoId);
    if (ph) {
      const d = ph.designs.find((x) => x.id === ph.activeDesignId) ?? ph.designs[0];
      if (d) {
        fn(d, ph);
        d.updatedAt = Date.now();
      }
      return;
    }
  }
}

function withPhoto(draft: Draft<Project>, photoId: string | null, fn: (ph: Draft<Photo>, space: Draft<Space>) => void) {
  if (!photoId) return;
  for (const space of draft.spaces) {
    const ph = space.photos.find((p) => p.id === photoId);
    if (ph) {
      fn(ph, space);
      return;
    }
  }
}

function firstSelection(p: Project): Selection {
  const space = p.spaces[0];
  const photo = space?.photos[0];
  return { spaceId: space?.id ?? null, photoId: photo?.id ?? null, regionId: null, objectId: null, lightId: null };
}

const EMPTY_SELECTION: Selection = { spaceId: null, photoId: null, regionId: null, objectId: null, lightId: null };

export const useStore = create<AppState>()((set, get) => {
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    const p = get().project;
    if (!p || readOnlyOf === p.id) return; // read-only here: nothing is saved
    set({ saveState: 'saving' });
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Saves `p` (default: the open project, read right away — before any await)
   * and then deletes the pixel data queued for cleanup. Resolves true once the
   * document is written; false when this tab may not save it or the save failed.
   */
  function saveNow(p = get().project): Promise<boolean> {
    if (!p || readOnlyOf === p.id) return Promise.resolve(false);
    const run = saveChain.then(() => writeProject(p));
    saveChain = run.catch(() => undefined);
    return run;
  }

  /** Cancels the debounced save and saves now. */
  function flushSave(): Promise<boolean> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return saveNow();
  }

  async function writeProject(p: Project): Promise<boolean> {
    try {
      revs.set(p.id, await db.saveProject(p, { expectedRev: revs.get(p.id) }));
      const meta = db.projectMeta(p);
      set((s) => ({
        saveState: 'saved',
        projects: [meta, ...s.projects.filter((m) => m.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt),
      }));
      announce({ type: 'saved', id: p.id, meta });
    } catch (err) {
      if ((err as Error)?.name === 'StaleWriteError') {
        loseWriteAccess(p.id, 'stale');
        if (get().project?.id !== p.id) get().notify(`“${p.name}” was not saved: ${(err as Error).message}`, 'error');
      } else {
        set({ saveState: 'error' });
        get().notify(`Could not save: ${(err as Error).message}`, 'error');
      }
      return false;
    }
    await collectGarbage(p.id);
    return true;
  }

  /** This tab stops saving `projectId` (another tab took it over, or saved it since this copy was loaded). */
  function loseWriteAccess(projectId: string, reason: 'other-tab' | 'stale') {
    cleanupQueue.delete(projectId);
    if (get().project?.id !== projectId) return;
    readOnlyOf = projectId;
    runtime.setMasksReadOnly(true);
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ readOnly: reason, saveState: 'idle' });
  }

  // ------------------------------------------------------------ pixel cleanup

  let cleanupWarned = false;

  /** Queues pixel data of the open project whose last reference may be gone (see cleanupQueue). */
  function queueCleanup(projectId: string, blobIds: Iterable<string>, maskIds: Iterable<string>) {
    if (readOnlyOf === projectId) return; // a read-only tab never deletes anything
    let q = cleanupQueue.get(projectId);
    if (!q) cleanupQueue.set(projectId, (q = { blobIds: new Set(), maskIds: new Set() }));
    for (const id of blobIds) q.blobIds.add(id);
    for (const id of maskIds) q.maskIds.add(id);
  }

  /**
   * Undo history being thrown away (trimmed, cleared by a new edit, closed):
   * what only those snapshots referenced — an undone region's mask, a deleted
   * design's renders, the masks a re-map or "Sharpen again" replaced — is
   * queued for cleanup. `keep` and `remaining` stay referenced.
   */
  function discardHistory(dropped: HistoryEntry[], keep: Project, remaining: HistoryEntry[]) {
    if (!dropped.length || readOnlyOf === keep.id) return;
    try {
      reclaimDropped(dropped, keep, remaining);
    } catch (err) {
      // Bookkeeping must never break an edit; leftovers go in the startup sweep.
      if (!cleanupWarned) console.warn('[store] could not track unused images', err);
      cleanupWarned = true;
    }
  }

  function reclaimDropped(dropped: HistoryEntry[], keep: Project, remaining: HistoryEntry[]) {
    const blobs = new Set<string>();
    const masks = new Set<string>();
    for (const e of dropped) {
      if (e.kind === 'mask') {
        masks.add(e.maskId);
        continue;
      }
      for (const snap of [e.before, e.after]) {
        const r = refsOf(snap);
        for (const id of r.blobIds) blobs.add(id);
        for (const id of r.maskIds) masks.add(id);
      }
    }
    const unmark = (p: Project) => {
      const r = refsOf(p);
      for (const id of r.blobIds) blobs.delete(id);
      for (const id of r.maskIds) masks.delete(id);
    };
    unmark(keep);
    for (const e of remaining) {
      if (!blobs.size && !masks.size) return;
      if (e.kind === 'mask') masks.delete(e.maskId);
      else {
        unmark(e.before);
        unmark(e.after);
      }
    }
    if (!blobs.size && !masks.size) return;
    runtime.forgetMasks([...masks]); // also cancels a pending write that would bring a mask back
    queueCleanup(keep.id, blobs, masks);
  }

  /** Deletes the queued ids nothing references any more (runs after a successful save). */
  async function collectGarbage(projectId: string): Promise<void> {
    const q = cleanupQueue.get(projectId);
    if (!q) return;
    cleanupQueue.delete(projectId);
    try {
      const [stored, library] = await Promise.all([db.loadProject(projectId), db.loadLibrary()]);
      const live = new Set<string>();
      const mark = (p: Project | null | undefined) => {
        if (!p) return;
        const r = refsOf(p);
        for (const id of r.blobIds) live.add(id);
        for (const id of r.maskIds) live.add(id);
      };
      mark(stored);
      const s = get();
      if (s.project?.id === projectId) {
        mark(s.project);
        for (const e of [...s.past, ...s.future]) {
          if (e.kind === 'mask') live.add(e.maskId);
          else {
            mark(e.before);
            mark(e.after);
          }
        }
      }
      for (const a of [...library, ...s.library]) if (a.imageId) live.add(a.imageId);
      const blobIds = [...q.blobIds].filter((id) => !live.has(id));
      const maskIds = [...q.maskIds].filter((id) => !live.has(id));
      runtime.forgetMasks(maskIds);
      await Promise.all([db.deleteBlobs(blobIds), db.deleteMasks(maskIds)]);
    } catch (err) {
      // Left for the startup sweep (db.sweepWhenIdle).
      console.warn('[store] could not clean up unused images', err);
    }
  }

  // ------------------------------------------------------- tabs & write locks

  /** Claims a project's write lock (`steal`: take it from another tab). Resolves true when this tab may save it. */
  function claimWriteLock(id: string, steal = false): Promise<boolean> {
    const locks = lockManager();
    if (!locks) return Promise.resolve(true); // no Web Locks (tests, old browsers): behave as the only tab
    if (heldLocks.has(id) && !steal) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      locks
        .request(`${db.PROJECT_LOCK_PREFIX}${id}`, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          heldLocks.set(id, release);
          resolve(true);
          return held;
        })
        .catch(() => {
          // Another tab took this project over: stop saving it here.
          if (heldLocks.get(id) === release) {
            heldLocks.delete(id);
            loseWriteAccess(id, 'other-tab');
          }
          resolve(false);
        });
    });
  }

  function releaseWriteLock(id: string) {
    heldLocks.get(id)?.();
    heldLocks.delete(id);
  }

  /** Shared storage lock for as long as a project is open: another tab's startup sweep waits for it. */
  function holdStorageLock(): Promise<void> {
    const locks = lockManager();
    if (!locks || releaseStorageLock) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const held = new Promise<void>((r) => (releaseStorageLock = r));
      locks.request(db.GC_LOCK, { mode: 'shared' }, () => (resolve(), held)).catch(() => resolve());
    });
  }

  /**
   * Leaves the open project `prev`: its history is thrown away (what only the
   * history referenced is queued for cleanup) and the pending save is flushed.
   * Synchronous up to the save, which captures `prev` before any await.
   */
  function leaveProject(prev: Project): Promise<boolean> {
    const s = get();
    discardHistory([...s.past, ...s.future], prev, []);
    const pending = !!saveTimer || cleanupQueue.has(prev.id);
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return pending ? saveNow(prev) : Promise.resolve(true);
  }

  /** Replaces the open project with its stored copy (another tab's save, or taking it over). */
  function adoptStored(rec: { project: Project; rev: number }, writable: boolean) {
    const p = rec.project;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    cleanupQueue.delete(p.id);
    readOnlyOf = writable ? null : p.id;
    runtime.setMasksReadOnly(!writable);
    revs.set(p.id, rec.rev);
    const { selection, readOnly } = get();
    const valid = (!selection.spaceId || !!findSpace(p, selection.spaceId)) && (!selection.photoId || !!findPhoto(p, selection.photoId));
    set({
      project: p,
      past: [],
      future: [],
      readOnly: writable ? null : (readOnly ?? 'other-tab'),
      saveState: 'idle',
      selection: valid ? selection : firstSelection(p),
    });
  }

  let channel: BroadcastChannel | null = null;
  function announce(msg: ChannelMessage) {
    try {
      channel?.postMessage(msg);
    } catch {
      // another tab just won't refresh its list
    }
  }

  async function onChannelMessage(msg: ChannelMessage) {
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string') return;
    if (msg.type === 'deleted') {
      set((s) => ({ projects: s.projects.filter((m) => m.id !== msg.id) }));
      return;
    }
    if (msg.type !== 'saved' || !msg.meta) return;
    set((s) => ({ projects: [msg.meta, ...s.projects.filter((m) => m.id !== msg.id)].sort((a, b) => b.updatedAt - a.updatedAt) }));
    // A read-only copy follows the tab that saves it.
    if (get().project?.id !== msg.id || readOnlyOf !== msg.id) return;
    const rec = await db.loadProjectRecord(msg.id).catch(() => undefined);
    if (rec && get().project?.id === msg.id && readOnlyOf === msg.id) adoptStored(rec, false);
  }

  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('mode-projects');
    channel.onmessage = (e: MessageEvent<ChannelMessage>) => void onChannelMessage(e.data);
  }

  /** After undo / redo: a selected space or photo that no longer exists falls back to the first one. */
  function repairSelection() {
    const { project, selection } = get();
    if (!project) return;
    if ((selection.spaceId && !findSpace(project, selection.spaceId)) || (selection.photoId && !findPhoto(project, selection.photoId))) {
      set({ selection: firstSelection(project) });
    }
  }

  function applyMaskBytes(maskId: string, bytes: Uint8Array) {
    const m = runtime.getMask(maskId);
    if (!m || m.data.length !== bytes.length) return;
    m.data.set(bytes);
    runtime.markMaskDirty(maskId);
  }

  runtime.onMaskChanged((maskId) => {
    set((s) => ({ maskVersions: { ...s.maskVersions, [maskId]: (s.maskVersions[maskId] ?? 0) + 1 } }));
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void saveNow();
      }
      void runtime.flushMasks();
    });
  }

  return {
    ready: false,
    projects: [],
    project: null,
    library: [],
    mode: 'studio',
    studio: {
      panel: 'design',
      viewVariationId: null,
      gridGenerationId: null,
      showZones: true,
      focusZoneId: null,
      sketch: 'none',
      variationCount: 3,
      renderMode: 'handoff',
      handoffApp: 'chatgpt',
      provider: null,
      quality: 'standard',
      activeElementId: null,
    },
    runs: {},
    selection: EMPTY_SELECTION,
    tool: 'select',
    toolOptions: {
      brushRadius: 24,
      brushHardness: 0.7,
      maskMode: 'add',
      wandTolerance: 14,
      wandContiguous: true,
      smartTolerance: 16,
    },
    placement: null,
    panel: 'surfaces',
    view: { compare: 'off', masks: 'selected', showOriginal: false, mobilePane: 'editor' },
    maskVersions: {},
    pickedColor: null,
    health: null,
    shop: null,
    saveState: 'idle',
    readOnly: null,
    toasts: [],
    past: [],
    future: [],

    // ----------------------------------------------------------------- projects
    async init() {
      // Pixel data no project references any more (leaked by older versions, or left by a
      // crash between a write and the save that references it). Started before any project
      // opens; skipped while another tab has a project open or an import running.
      void db.sweepWhenIdle().catch((err) => console.warn('[store] storage sweep skipped', err));
      try {
        const [projects, library] = await Promise.all([db.listProjects(), db.loadLibrary()]);
        set({ projects, library, ready: true });
      } catch (err) {
        set({ ready: true });
        get().notify(`Storage unavailable: ${(err as Error).message}`, 'error');
      }
      void db.requestPersistentStorage();
      void get().refreshHealth();
    },

    async refreshHealth() {
      const health = await getHealth();
      set({ health });
    },

    async createProject(name) {
      const p = newProject(name);
      await db.saveProject(p);
      set((s) => ({ projects: [db.projectMeta(p), ...s.projects] }));
      await get().openProject(p.id);
      return p.id;
    },

    async openProject(id) {
      // Re-opening the open project: load what is saved, including its last edits.
      if (get().project?.id === id) await flushSave();
      await holdStorageLock();
      // One tab saves a project; another tab opening it gets a read-only copy (see takeOver).
      const writable = await claimWriteLock(id);
      const rec = await db.loadProjectRecord(id).catch((err: unknown) => {
        get().notify(`Could not open the project: ${(err as Error).message}`, 'error');
        return null;
      });
      if (!rec) {
        if (rec === undefined) get().notify('Project not found', 'error');
        if (get().project?.id !== id) releaseWriteLock(id);
        if (!get().project) {
          releaseStorageLock?.();
          releaseStorageLock = null;
        }
        return;
      }
      const p = rec.project;
      await runtime.clearRuntime();
      // Flush the outgoing project's pending save now: saveNow captures it before the swap below.
      const prev = get().project;
      const left = prev ? leaveProject(prev) : undefined;
      readOnlyOf = writable ? null : id;
      runtime.setMasksReadOnly(!writable);
      revs.set(id, rec.rev);
      set({
        project: p,
        readOnly: writable ? null : 'other-tab',
        selection: firstSelection(p),
        past: [],
        future: [],
        maskVersions: {},
        placement: null,
        tool: 'select',
        saveState: 'idle',
        mode: 'studio',
        studio: { ...get().studio, viewVariationId: null, gridGenerationId: null, focusZoneId: null, sketch: 'none', activeElementId: null },
        view: { ...get().view, mobilePane: 'editor', compare: 'off', showOriginal: false },
      });
      if (prev) {
        await left;
        if (prev.id !== id) releaseWriteLock(prev.id);
      }
    },

    async closeProject() {
      await runtime.clearRuntime();
      // Flush the pending save (and the cleanup it runs) before the project goes.
      const prev = get().project;
      const left = prev ? leaveProject(prev) : undefined;
      readOnlyOf = null;
      runtime.setMasksReadOnly(false);
      set({ project: null, readOnly: null, selection: EMPTY_SELECTION, past: [], future: [], placement: null });
      if (prev) {
        await left;
        releaseWriteLock(prev.id);
      }
      releaseStorageLock?.();
      releaseStorageLock = null;
    },

    async deleteProject(id) {
      if (get().project?.id === id) await get().closeProject();
      cleanupQueue.delete(id);
      await db.deleteProject(id);
      revs.delete(id);
      set((s) => ({ projects: s.projects.filter((m) => m.id !== id) }));
      announce({ type: 'deleted', id });
    },

    async takeOver() {
      const p = get().project;
      if (!p) return;
      const writable = await claimWriteLock(p.id, !heldLocks.has(p.id));
      const rec = await db.loadProjectRecord(p.id).catch(() => undefined);
      if (get().project?.id !== p.id) return;
      if (!rec) {
        readOnlyOf = p.id; // nothing to save back: it was deleted elsewhere
        runtime.setMasksReadOnly(true);
        get().notify('This project was deleted in another tab.', 'error');
        await get().closeProject();
        return;
      }
      if (writable) {
        // Masks cached here may be older than the stored ones: refresh them in place before editing resumes.
        await Promise.all(
          refsOf(rec.project).maskIds.map(async (maskId) => {
            const m = runtime.getMask(maskId);
            const stored = m ? await db.getMask(maskId) : undefined;
            if (m && stored && stored.width === m.width && stored.height === m.height) {
              m.data.set(stored.data);
              runtime.markMaskDirty(maskId);
            }
          }),
        );
      }
      adoptStored(rec, writable);
      if (!writable) get().notify('Mode could not take this project over from the other tab. Close it there and try again.', 'error');
    },

    updateProjectInfo(patch) {
      get().mutateProject('Edit project', (d) => {
        if (patch.name !== undefined) d.name = patch.name;
        if (patch.location !== undefined) d.location = patch.location;
        if ('budget' in patch) d.budget = patch.budget;
        if ('style' in patch) d.style = patch.style;
      }, { coalesce: 'project-info' });
    },

    async exportProject() {
      const p = get().project;
      if (!p) return;
      await runtime.flushMasks();
      const used = new Set<string>();
      for (const sp of p.spaces) for (const ph of sp.photos) for (const d of ph.designs) {
        for (const o of d.objects) used.add(o.assetId);
        for (const l of d.lights) if (l.assetId) used.add(l.assetId);
      }
      const lib = get().library.filter((a) => used.has(a.id));
      const blob = await db.exportProjectBundle(p, lib);
      const safe = p.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'project';
      downloadBlob(blob, `${safe}.mode.json`);
    },

    async importProject(file) {
      try {
        const { project, library } = await db.importProjectBundle(file);
        const known = new Set(get().library.map((a) => a.id));
        set((s) => ({
          projects: [db.projectMeta(project), ...s.projects],
          library: [...s.library, ...library.filter((a) => !known.has(a.id))],
        }));
        await get().openProject(project.id);
        get().notify(`Imported “${project.name}”`, 'success');
      } catch (err) {
        get().notify(`Import failed: ${(err as Error).message}`, 'error');
      }
    },

    // ------------------------------------------------------------- spaces/photos
    addSpace(type, name) {
      const id = newId('spc');
      const p = get().project;
      if (!p) return id;
      const sameType = p.spaces.filter((s) => s.type === type).length;
      const label = name?.trim() || (sameType ? `${SPACE_TYPE_LABELS[type]} ${sameType + 1}` : SPACE_TYPE_LABELS[type]);
      get().mutateProject('Add space', (d) => {
        d.spaces.push({ id, name: label, type, kind: spaceKindOf(type), photos: [], createdAt: Date.now() });
      });
      set({ selection: { ...EMPTY_SELECTION, spaceId: id } });
      return id;
    },

    updateSpace(id, patch) {
      get().mutateProject('Edit space', (d) => {
        const sp = d.spaces.find((s) => s.id === id);
        if (!sp) return;
        if (patch.name !== undefined) sp.name = patch.name;
        if (patch.notes !== undefined) sp.notes = patch.notes;
        if (patch.type !== undefined) {
          sp.type = patch.type;
          sp.kind = spaceKindOf(patch.type);
        }
      }, { coalesce: `space:${id}` });
    },

    async deleteSpace(id) {
      const p = get().project;
      const sp = findSpace(p, id);
      if (!p || !sp) return;
      const blobIds: string[] = [];
      const maskIds: string[] = [];
      for (const ph of sp.photos) {
        const refs = photoRefs(ph);
        blobIds.push(...refs.blobIds);
        maskIds.push(...refs.maskIds);
        runtime.forgetPhoto(ph.id);
      }
      runtime.forgetMasks(maskIds);
      const next = produce(p, (d) => {
        d.spaces = d.spaces.filter((s) => s.id !== id);
        for (const it of d.ideaBoard) {
          if (!it.spaceIds.includes(id)) continue;
          it.spaceIds = it.spaceIds.filter((s) => s !== id);
          // Scoped only to this space: keep it on the board but off, rather than widen it to the whole house.
          if (it.spaceIds.length === 0) it.active = false;
        }
        d.updatedAt = Date.now();
      });
      // Deleting pixel data cannot be undone: clear history. The pixels go once the
      // document without them is saved (a crash in between leaves orphans, not broken photos).
      const { past, future } = get();
      set({ project: next, past: [], future: [], selection: firstSelection(next) });
      discardHistory([...past, ...future], next, []);
      queueCleanup(p.id, blobIds, maskIds);
      await flushSave();
    },

    async addPhotos(spaceId, files) {
      // Bound to the project and space open when the import started: a slow import
      // must not land in another project, or report photos added to a deleted space.
      const pid = get().project?.id;
      if (!pid) return [];
      const targetExists = () => {
        const cur = get().project;
        return cur?.id === pid && !!findSpace(cur, spaceId);
      };
      const ids: string[] = [];
      let lost = false;
      // GPS / compass heading / capture time come from the ORIGINAL file: importing
      // re-encodes the photo, which strips EXIF. Loaded on demand; never blocks an import.
      const readCapture = (file: File) =>
        import('../site/capture').then((m) => m.readPhotoCapture(file)).catch(() => undefined);
      for (const file of files) {
        if (!targetExists()) {
          lost = true;
          break;
        }
        try {
          const [imported, capture] = await Promise.all([importImageFile(file), readCapture(file)]);
          const photoId = newId('pho');
          const imageId = newId('img');
          const thumbId = newId('img');
          await Promise.all([db.putBlob(imageId, imported.blob), db.putBlob(thumbId, imported.thumb)]);
          if (!targetExists()) {
            await db.deleteBlobs([imageId, thumbId]);
            lost = true;
            break;
          }
          const design = newDesign('Option A');
          const photo: Photo = {
            id: photoId,
            name: file.name.replace(/\.[^.]+$/, '') || 'Photo',
            imageId,
            thumbId,
            width: imported.width,
            height: imported.height,
            createdAt: Date.now(),
            regions: [],
            generations: [],
            designs: [design],
            activeDesignId: design.id,
            ...(capture ? { capture } : {}),
          };
          get().mutateProject('Add photo', (d) => {
            d.spaces.find((s) => s.id === spaceId)?.photos.push(photo);
          }, { history: false });
          ids.push(photoId);
        } catch (err) {
          get().notify(`${file.name}: ${(err as Error).message}`, 'error');
        }
      }
      if (lost) get().notify('The project or space closed before the photos finished importing.', 'error');
      if (!targetExists()) return [];
      if (ids.length) {
        set((s) => ({
          selection: { ...EMPTY_SELECTION, spaceId, photoId: ids[ids.length - 1] },
          view: { ...s.view, mobilePane: 'editor' },
        }));
      }
      return ids;
    },

    renamePhoto(photoId, name) {
      get().mutateProject('Rename photo', (d) => withPhoto(d, photoId, (ph) => void (ph.name = name)), {
        coalesce: `photo-name:${photoId}`,
      });
    },

    async deletePhoto(photoId) {
      const p = get().project;
      const found = findPhoto(p, photoId);
      if (!p || !found) return;
      const { photo, space } = found;
      const { blobIds, maskIds } = photoRefs(photo);
      runtime.forgetPhoto(photoId);
      runtime.forgetMasks(maskIds);
      const next = produce(p, (d) => {
        const sp = d.spaces.find((s) => s.id === space.id);
        if (sp) sp.photos = sp.photos.filter((ph) => ph.id !== photoId);
        d.updatedAt = Date.now();
      });
      const remaining = findSpace(next, space.id)?.photos ?? [];
      const { past, future } = get();
      set({
        project: next,
        past: [],
        future: [],
        selection: { ...EMPTY_SELECTION, spaceId: space.id, photoId: remaining[0]?.id ?? null },
      });
      // The pixels go once the document without the photo is saved.
      discardHistory([...past, ...future], next, []);
      queueCleanup(p.id, blobIds, maskIds);
      await flushSave();
    },

    setCalibration(photoId, calibration) {
      get().mutateProject('Calibrate', (d) => withPhoto(d, photoId, (ph) => void (ph.calibration = calibration)));
    },

    setAnalysis(photoId, analysis) {
      get().mutateProject('AI analysis', (d) => withPhoto(d, photoId, (ph) => void (ph.analysis = analysis)), {
        history: false,
      });
    },

    // ------------------------------------------------------------------ regions
    addRegion(surface, name) {
      const photo = selectActivePhoto(get());
      if (!photo) return null;
      const id = newId('reg');
      const maskId = newId('msk');
      const sameSurface = photo.regions.filter((r) => r.surface === surface).length;
      const label = name?.trim() || (sameSurface ? `${SURFACE_LABELS[surface]} ${sameSurface + 1}` : SURFACE_LABELS[surface]);
      runtime.setMask(maskId, createMask(photo.width, photo.height));
      const region: Region = {
        id,
        name: label,
        surface,
        maskId,
        color: REGION_COLORS[photo.regions.length % REGION_COLORS.length],
        createdAt: Date.now(),
      };
      get().mutateProject('Add surface', (d) => withPhoto(d, photo.id, (ph) => void ph.regions.push(region)));
      set((s) => ({ selection: { ...s.selection, regionId: id, objectId: null, lightId: null } }));
      return id;
    },

    updateRegion(regionId, patch, opts) {
      const photoId = get().selection.photoId;
      get().mutateProject('Edit surface', (d) =>
        withPhoto(d, photoId, (ph) => {
          const r = ph.regions.find((x) => x.id === regionId);
          if (r) Object.assign(r, patch);
        }), opts ?? { coalesce: `region:${regionId}` });
    },

    deleteRegion(regionId) {
      const photoId = get().selection.photoId;
      get().mutateProject('Delete surface', (d) =>
        withPhoto(d, photoId, (ph) => {
          ph.regions = ph.regions.filter((r) => r.id !== regionId);
          for (const des of ph.designs) {
            delete des.treatments[regionId];
            des.hiddenRegionIds = des.hiddenRegionIds.filter((id) => id !== regionId);
          }
        }));
      set((s) => ({ selection: { ...s.selection, regionId: s.selection.regionId === regionId ? null : s.selection.regionId } }));
    },

    moveRegion(regionId, direction) {
      const photoId = get().selection.photoId;
      get().mutateProject('Reorder surfaces', (d) =>
        withPhoto(d, photoId, (ph) => {
          const i = ph.regions.findIndex((r) => r.id === regionId);
          const j = i + direction;
          if (i < 0 || j < 0 || j >= ph.regions.length) return;
          const [r] = ph.regions.splice(i, 1);
          ph.regions.splice(j, 0, r);
        }));
    },

    // ------------------------------------------------------------------ designs
    addDesign(name, copyActive = true) {
      const photo = selectActivePhoto(get());
      if (!photo) return null;
      const source = activeDesignOf(photo);
      const base = newDesign(name?.trim() || `Option ${designLetter(photo.designs.length)}`);
      const design: Design =
        copyActive && source
          ? {
              ...structuredClone(source),
              id: base.id,
              name: base.name,
              createdAt: base.createdAt,
              updatedAt: base.updatedAt,
              aiRenders: [],
              objects: source.objects.map((o) => ({ ...o, id: newId('obj') })),
              lights: source.lights.map((l) => ({ ...l, id: newId('lgt') })),
            }
          : base;
      get().mutateProject('New design option', (d) =>
        withPhoto(d, photo.id, (ph) => {
          ph.designs.push(design);
          ph.activeDesignId = design.id;
        }));
      set((s) => ({ selection: { ...s.selection, objectId: null, lightId: null } }));
      return design.id;
    },

    renameDesign(designId, name) {
      const photoId = get().selection.photoId;
      get().mutateProject('Rename design', (d) =>
        withPhoto(d, photoId, (ph) => {
          const des = ph.designs.find((x) => x.id === designId);
          if (des) des.name = name;
        }), { coalesce: `design-name:${designId}` });
    },

    deleteDesign(designId) {
      const photoId = get().selection.photoId;
      get().mutateProject('Delete design option', (d) =>
        withPhoto(d, photoId, (ph) => {
          if (ph.designs.length <= 1) return;
          ph.designs = ph.designs.filter((x) => x.id !== designId);
          if (ph.activeDesignId === designId) ph.activeDesignId = ph.designs[0].id;
        }));
      set((s) => ({ selection: { ...s.selection, objectId: null, lightId: null } }));
    },

    setActiveDesign(designId) {
      const photoId = get().selection.photoId;
      get().mutateProject('Switch design option', (d) =>
        withPhoto(d, photoId, (ph) => {
          if (ph.designs.some((x) => x.id === designId)) ph.activeDesignId = designId;
        }), { history: false });
      set((s) => ({ selection: { ...s.selection, objectId: null, lightId: null } }));
    },

    setTreatment(regionId, treatment, opts) {
      get().mutateProject(treatment ? 'Apply finish' : 'Clear finish', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          if (treatment) des.treatments[regionId] = treatment;
          else delete des.treatments[regionId];
          des.hiddenRegionIds = des.hiddenRegionIds.filter((id) => id !== regionId);
        }), opts);
    },

    toggleRegionHidden(regionId) {
      get().mutateProject('Toggle surface', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          des.hiddenRegionIds = des.hiddenRegionIds.includes(regionId)
            ? des.hiddenRegionIds.filter((id) => id !== regionId)
            : [...des.hiddenRegionIds, regionId];
        }));
    },

    updateLighting(patch, opts) {
      get().mutateProject('Adjust lighting', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void Object.assign(des.lighting, patch)),
      opts ?? { coalesce: `lighting:${Object.keys(patch).join(',')}` });
    },

    addObject(obj) {
      const design = selectActiveDesign(get());
      if (!design) return null;
      const id = newId('obj');
      const z = obj.z ?? design.objects.reduce((m, o) => Math.max(m, o.z), 0) + 1;
      get().mutateProject('Place object', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void des.objects.push({ ...obj, id, z })));
      set((s) => ({ selection: { ...s.selection, objectId: id, lightId: null, regionId: null } }));
      return id;
    },

    updateObject(id, patch, opts) {
      get().mutateProject('Edit object', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          const o = des.objects.find((x) => x.id === id);
          if (o) Object.assign(o, patch);
        }), opts ?? { coalesce: `object:${id}` });
    },

    deleteObject(id) {
      get().mutateProject('Delete object', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          des.objects = des.objects.filter((o) => o.id !== id);
        }));
      set((s) => ({ selection: { ...s.selection, objectId: s.selection.objectId === id ? null : s.selection.objectId } }));
    },

    duplicateObject(id) {
      const design = selectActiveDesign(get());
      const src = design?.objects.find((o) => o.id === id);
      if (!src) return null;
      const { id: _id, z: _z, ...rest } = src;
      return get().addObject({ ...rest, x: src.x + src.height * 0.25, y: src.y });
    },

    reorderObject(id, to) {
      get().mutateProject('Reorder object', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          const sorted = [...des.objects].sort((a, b) => a.z - b.z);
          const i = sorted.findIndex((o) => o.id === id);
          if (i < 0) return;
          const [o] = sorted.splice(i, 1);
          const j = to === 'front' ? sorted.length : to === 'back' ? 0 : to === 'forward' ? Math.min(sorted.length, i + 1) : Math.max(0, i - 1);
          sorted.splice(j, 0, o);
          sorted.forEach((obj, idx) => {
            const target = des.objects.find((x) => x.id === obj.id);
            if (target) target.z = idx + 1;
          });
        }));
    },

    addLight(light) {
      const design = selectActiveDesign(get());
      if (!design) return null;
      const id = newId('lgt');
      get().mutateProject('Place light', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void des.lights.push({ ...light, id })));
      set((s) => ({ selection: { ...s.selection, lightId: id, objectId: null, regionId: null } }));
      return id;
    },

    updateLight(id, patch, opts) {
      get().mutateProject('Edit light', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          const l = des.lights.find((x) => x.id === id);
          if (l) Object.assign(l, patch);
        }), opts ?? { coalesce: `light:${id}` });
    },

    deleteLight(id) {
      get().mutateProject('Delete light', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          des.lights = des.lights.filter((l) => l.id !== id);
        }));
      set((s) => ({ selection: { ...s.selection, lightId: s.selection.lightId === id ? null : s.selection.lightId } }));
    },

    async addAIRender(blob, prompt, provider) {
      if (!selectActiveDesign(get())) return null;
      // Bound to the photo (and project) selected when the render started.
      const pid = get().project?.id;
      const photoId = get().selection.photoId;
      const id = newId('ren');
      const imageId = newId('img');
      await db.putBlob(imageId, blob);
      const cur = get().project;
      if (cur?.id !== pid || !findPhoto(cur, photoId)) {
        await db.deleteBlobs([imageId]);
        return null;
      }
      const render: AIRender = { id, imageId, prompt, provider, createdAt: Date.now() };
      get().mutateProject('AI render', (d) =>
        withActiveDesign(d, photoId, (des) => void des.aiRenders.unshift(render)), { history: false });
      return id;
    },

    deleteAIRender(renderId) {
      const design = selectActiveDesign(get());
      const r = design?.aiRenders.find((x) => x.id === renderId);
      const pid = get().project?.id;
      if (!r || !pid) return;
      get().mutateProject('Delete AI render', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          des.aiRenders = des.aiRenders.filter((x) => x.id !== renderId);
        }), { history: false });
      queueCleanup(pid, [r.imageId], []);
      void flushSave();
    },

    updateDesignNotes(notes) {
      get().mutateProject('Edit notes', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void (des.notes = notes)), { coalesce: 'design-notes' });
    },

    // ------------------------------------------------------------------- studio
    setMode(mode) {
      set({ mode, placement: null, tool: 'select' });
    },

    setStudio(patch) {
      set((s) => ({ studio: { ...s.studio, ...patch } }));
    },

    setScene(photoId, scene) {
      get().mutateProject(scene ? 'Analyze scene' : 'Clear scene', (d) =>
        withPhoto(d, photoId, (ph) => {
          const prev = ph.scene;
          if (scene && prev) {
            // Re-analysis replaces the AI's map but keeps what the user drew.
            const next = structuredClone(scene) as Draft<SceneMap>;
            const ids = new Set([...next.zones.map((z) => z.id), ...next.paths.map((p) => p.id)]);
            next.zones.push(...prev.zones.filter((z) => isSketchZone(z) && !ids.has(z.id)));
            next.paths.push(...prev.paths.filter((p) => p.kind === 'sketch' && !ids.has(p.id)));
            // A facade direction the user set by hand beats the AI's guess.
            if (prev.facadeAzimuthSource === 'user' && prev.facadeAzimuthDeg !== undefined) {
              next.facadeAzimuthDeg = prev.facadeAzimuthDeg;
              next.facadeAzimuthSource = 'user';
            }
            ph.scene = next;
          } else {
            ph.scene = scene as Draft<SceneMap> | undefined;
          }
        }));
    },

    updateScene(photoId, recipe, opts) {
      get().mutateProject('Edit scene', (d) =>
        withPhoto(d, photoId, (ph) => {
          if (ph.scene) recipe(ph.scene);
        }), opts ?? { coalesce: `scene:${photoId}` });
    },

    updateDraft(photoId, recipe, opts) {
      get().mutateProject('Edit brief', (d) =>
        withPhoto(d, photoId, (ph) => {
          if (!ph.draft) ph.draft = emptyBrief();
          recipe(ph.draft);
        }), opts ?? { coalesce: `draft:${photoId}` });
    },

    async addIdeaItem(item, blobs) {
      // Bound to the project open when the add started (blob writes, product image fetches are slow).
      const pid = get().project?.id;
      if (!pid) return null;
      const id = newId('idea');
      const full: IdeaItem = { ...item, id, createdAt: Date.now() };
      if (blobs?.image) {
        full.imageId = newId('img');
        await db.putBlob(full.imageId, blobs.image);
      }
      if (blobs?.thumb) {
        full.thumbId = newId('img');
        await db.putBlob(full.thumbId, blobs.thumb);
      }
      if (get().project?.id !== pid) {
        await db.deleteBlobs([full.imageId, full.thumbId].filter((x): x is string => !!x));
        return null;
      }
      get().mutateProject('Add idea', (d) => void d.ideaBoard.push(full));
      return id;
    },

    updateIdeaItem(id, patch, opts) {
      get().mutateProject('Edit idea', (d) => {
        const it = d.ideaBoard.find((x) => x.id === id);
        if (it) Object.assign(it, patch);
      }, opts ?? { coalesce: `idea:${id}` });
    },

    async removeIdeaItem(id) {
      const item = get().project?.ideaBoard.find((x) => x.id === id);
      if (!item) return;
      const next = produce(get().project!, (d) => {
        d.ideaBoard = d.ideaBoard.filter((x) => x.id !== id);
        for (const sp of d.spaces) for (const ph of sp.photos) {
          if (ph.draft) ph.draft.ideaItemIds = ph.draft.ideaItemIds.filter((x) => x !== id);
        }
        d.updatedAt = Date.now();
      });
      // Blob deletion cannot be undone: clear history. The blobs go once the document without the idea is saved.
      const { past, future } = get();
      set({ project: next, past: [], future: [] });
      discardHistory([...past, ...future], next, []);
      queueCleanup(next.id, [item.imageId, item.thumbId].filter((x): x is string => !!x), []);
      await flushSave();
    },

    addGeneration(photoId, generation) {
      get().mutateProject('Generate', (d) =>
        withPhoto(d, photoId, (ph) => void ph.generations.unshift(generation as Draft<Generation>)), { history: false });
    },

    updateGeneration(photoId, generationId, recipe) {
      get().mutateProject('Generate', (d) =>
        withPhoto(d, photoId, (ph) => {
          const g = ph.generations.find((x) => x.id === generationId);
          if (g) recipe(g);
        }), { history: false });
    },

    addVariation(photoId, generationId, variation) {
      get().mutateProject('Generate', (d) =>
        withPhoto(d, photoId, (ph) => {
          ph.generations.find((x) => x.id === generationId)?.variations.push(variation);
        }), { history: false });
    },

    toggleFavorite(photoId, variationId) {
      get().mutateProject('Favorite', (d) =>
        withPhoto(d, photoId, (ph) => {
          for (const g of ph.generations) {
            const v = g.variations.find((x) => x.id === variationId);
            if (v) v.favorite = !v.favorite;
          }
        }), { history: false });
    },

    async deleteVariation(photoId, variationId) {
      const ph = findPhoto(get().project, photoId)?.photo;
      if (ph && pendingRunsFrom(ph, variationId).length > 0) {
        const title = findVariation(ph, variationId)?.title ?? 'This variation';
        get().notify(`“${title}” is the starting image of a hand-off still waiting for its result — finish or skip it first.`, 'error');
        return false;
      }
      let removed: Variation | undefined;
      get().mutateProject('Delete variation', (d) =>
        withPhoto(d, photoId, (ph) => {
          for (const g of ph.generations) {
            const v = g.variations.find((x) => x.id === variationId);
            if (v) {
              removed = { ...v };
              g.variations = g.variations.filter((x) => x.id !== variationId);
            }
          }
        }), { history: false });
      set((s) => ({
        studio: s.studio.viewVariationId === variationId ? { ...s.studio, viewVariationId: null } : s.studio,
      }));
      const pid = get().project?.id;
      if (removed && pid) {
        // Deleted once the document without it is saved (and nothing else references it).
        queueCleanup(pid, [removed.imageId, removed.thumbId], []);
        await flushSave();
      }
      return true;
    },

    async deleteGeneration(photoId, generationId) {
      const ph = findPhoto(get().project, photoId)?.photo;
      const g = ph?.generations.find((x) => x.id === generationId);
      if (!g) return;
      get().mutateProject('Delete run', (d) =>
        withPhoto(d, photoId, (p) => {
          p.generations = p.generations.filter((x) => x.id !== generationId);
        }), { history: false });
      const ids = new Set(g.variations.map((v) => v.id));
      set((s) => ({
        studio: {
          ...s.studio,
          viewVariationId: s.studio.viewVariationId && ids.has(s.studio.viewVariationId) ? null : s.studio.viewVariationId,
          gridGenerationId: s.studio.gridGenerationId === generationId ? null : s.studio.gridGenerationId,
        },
      }));
      // Variations, hand-off packs, staged results (+ change maps) and the run's frozen target
      // masks — deleted once the document without the run is saved.
      const owned = db.generationOwnedIds(g);
      runtime.forgetMasks(owned.maskIds);
      const pid = get().project?.id;
      if (!pid) return;
      queueCleanup(pid, owned.blobIds, owned.maskIds);
      await flushSave();
    },

    setRecommendations(photoId, items, baseVariationId) {
      get().mutateProject('Suggestions', (d) =>
        withPhoto(d, photoId, (ph) => void (ph.recommendations = { items, createdAt: Date.now(), baseVariationId })), {
        history: false,
      });
    },

    setRunProgress(generationId, progress) {
      set((s) => {
        const runs = { ...s.runs };
        if (progress) runs[generationId] = progress;
        else delete runs[generationId];
        return { runs };
      });
    },

    // ------------------------------------------------------------------ library
    async addLibraryAsset(asset, imageBlob) {
      let a = asset;
      if (imageBlob) {
        const imageId = asset.imageId ?? newId('img');
        await db.putBlob(imageId, imageBlob);
        a = { ...asset, imageId };
      }
      const library = [...get().library.filter((x) => x.id !== a.id), a];
      set({ library });
      await db.saveLibrary(library);
    },

    async updateLibraryAsset(id, patch) {
      const library = get().library.map((a) => (a.id === id ? { ...a, ...patch } : a));
      evictAssetImage(id);
      set({ library });
      await db.saveLibrary(library);
    },

    async deleteLibraryAsset(id) {
      const asset = get().library.find((a) => a.id === id);
      const library = get().library.filter((a) => a.id !== id);
      evictAssetImage(id);
      set({ library });
      await db.saveLibrary(library);
      if (asset?.imageId) await db.deleteBlobs([asset.imageId]);
    },

    // ----------------------------------------------------------------------- ui
    select(patch) {
      set((s) => ({ selection: { ...s.selection, ...patch } }));
    },

    selectSpace(spaceId) {
      const sp = findSpace(get().project, spaceId);
      set((s) => ({
        selection: { ...EMPTY_SELECTION, spaceId, photoId: sp?.photos[0]?.id ?? null },
        placement: null,
        studio: { ...s.studio, viewVariationId: null, gridGenerationId: null, focusZoneId: null, sketch: 'none', activeElementId: null },
      }));
    },

    selectPhoto(photoId) {
      const found = findPhoto(get().project, photoId);
      if (!found) return;
      set((s) => ({
        selection: { ...EMPTY_SELECTION, spaceId: found.space.id, photoId },
        placement: null,
        view: { ...s.view, mobilePane: 'editor', compare: 'off' },
        studio: { ...s.studio, viewVariationId: null, gridGenerationId: null, focusZoneId: null, sketch: 'none', activeElementId: null },
      }));
    },

    setTool(tool) {
      set((s) => ({ tool, placement: tool === 'place' ? s.placement : null }));
    },

    setToolOptions(patch) {
      set((s) => ({ toolOptions: { ...s.toolOptions, ...patch } }));
    },

    setPlacement(placement) {
      set({ placement, tool: placement ? 'place' : 'select' });
    },

    setPanel(panel) {
      set({ panel });
    },

    setView(patch) {
      set((s) => ({ view: { ...s.view, ...patch } }));
    },

    setPickedColor(hex) {
      set({ pickedColor: hex });
    },

    openShop(req) {
      set({ shop: { query: req?.query ?? '', category: req?.category ?? 'plant' } });
    },

    closeShop() {
      set({ shop: null });
    },

    notify(message, kind = 'info') {
      const id = newId('tst');
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    // ------------------------------------------------------------------ history
    mutateProject(label, recipe, opts = {}) {
      const s = get();
      const before = s.project;
      if (!before) return;
      const after = produce(before, (d) => {
        recipe(d);
        d.updatedAt = Date.now();
      });
      if (after === before) return;
      let past: HistoryEntry[];
      let future: HistoryEntry[];
      /** History thrown away by this change (its pixels may be reclaimed). */
      const dropped: HistoryEntry[] = [];
      if (opts.history === false) {
        // Not undoable, so it must also survive undo/redo: replay the same
        // change onto every snapshot in the history (no-op where it doesn't apply).
        // Without this, undoing an older edit would silently drop e.g. a
        // finished generation or a newly uploaded photo.
        const rebase = (p: Project) => {
          try {
            return produce(p, (d) => void recipe(d));
          } catch {
            return p; // the change doesn't apply to this older snapshot
          }
        };
        // past is oldest → newest; its last entry's `after` is the current project.
        past = [];
        for (let i = s.past.length - 1; i >= 0; i--) {
          const e = s.past[i];
          if (e.kind !== 'project') {
            past.push(e);
            continue;
          }
          const b = rebase(e.before);
          const a = rebase(e.after);
          // The change landed on `after` but has nowhere to go on `before` (e.g. a photo
          // uploaded into a space that "Add space" created): undoing past this entry would
          // silently drop it, so the entry and everything older stop being undoable.
          if (a !== e.after && b === e.before) {
            dropped.push(...s.past.slice(0, i + 1));
            break;
          }
          past.push({ ...e, before: b, after: a });
        }
        past.reverse();
        // future is nearest → farthest; its first entry's `before` is the current project.
        future = [];
        for (let i = 0; i < s.future.length; i++) {
          const e = s.future[i];
          if (e.kind !== 'project') {
            future.push(e);
            continue;
          }
          const b = rebase(e.before);
          const a = rebase(e.after);
          // Redoing this entry would drop the change (e.g. it re-applies an undone delete).
          if (b !== e.before && a === e.after) {
            dropped.push(...s.future.slice(i));
            break;
          }
          future.push({ ...e, before: b, after: a });
        }
      } else {
        const now = Date.now();
        const last = s.past[s.past.length - 1];
        if (opts.coalesce && last?.kind === 'project' && last.key === opts.coalesce && now - last.at < COALESCE_MS) {
          past = [...s.past.slice(0, -1), { ...last, after, at: now }];
          dropped.push(last); // its intermediate `after` is replaced
        } else {
          const all = [...s.past, { kind: 'project', label, before, after, key: opts.coalesce, at: now } as HistoryEntry];
          past = all.slice(-HISTORY_LIMIT);
          dropped.push(...all.slice(0, all.length - past.length));
        }
        future = [];
        dropped.push(...s.future);
      }
      set({ project: after, past, future });
      discardHistory(dropped, after, [...past, ...future]);
      scheduleSave();
    },

    recordMaskEdit(maskId, before, after, label = 'Edit mask') {
      const s = get();
      const all = [...s.past, { kind: 'mask', label, maskId, before, after, at: Date.now() } as HistoryEntry];
      const past = all.slice(-HISTORY_LIMIT);
      set({ past, future: [] });
      if (s.project) discardHistory([...all.slice(0, all.length - past.length), ...s.future], s.project, past);
    },

    undo() {
      const { past, future, project } = get();
      const entry = past[past.length - 1];
      if (!entry) return;
      if (entry.kind === 'project') {
        if (!project) return;
        set({ project: entry.before, past: past.slice(0, -1), future: [entry, ...future] });
        repairSelection();
        scheduleSave();
      } else {
        applyMaskBytes(entry.maskId, entry.before);
        set({ past: past.slice(0, -1), future: [entry, ...future] });
      }
    },

    redo() {
      const { past, future, project } = get();
      const entry = future[0];
      if (!entry) return;
      if (entry.kind === 'project') {
        if (!project) return;
        set({ project: entry.after, past: [...past, entry], future: future.slice(1) });
        repairSelection();
        scheduleSave();
      } else {
        applyMaskBytes(entry.maskId, entry.after);
        set({ past: [...past, entry], future: future.slice(1) });
      }
    },
  };
});

/** Snapshot a mask before an edit (pair with recordMaskEdit after the edit). */
export function snapshotMask(maskId: string): Uint8Array | null {
  const m = runtime.getMask(maskId);
  return m ? new Uint8Array(m.data) : null;
}

/** Replace a mask's pixels and make it undoable in one step. */
export function replaceMaskPixels(maskId: string, next: Uint8Array, label: string): void {
  const m = runtime.getMask(maskId);
  if (!m || m.data.length !== next.length) return;
  const before = new Uint8Array(m.data);
  copyMaskInto(m, { width: m.width, height: m.height, data: next });
  runtime.markMaskDirty(maskId);
  useStore.getState().recordMaskEdit(maskId, before, new Uint8Array(next), label);
}
