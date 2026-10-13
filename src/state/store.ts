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
import type { HealthResponse } from '../../shared/api';
import { newId } from '../../shared/ids';
import {
  DEFAULT_LIGHTING,
  SPACE_TYPE_LABELS,
  SURFACE_LABELS,
  spaceKindOf,
  type AIRender,
  type AssetDef,
  type AssetListItem,
  type Calibration,
  type Design,
  type LightBeam,
  type LightingSettings,
  type Photo,
  type PlacedLight,
  type PlacedObject,
  type Project,
  type ProjectMeta,
  type Region,
  type Space,
  type SpaceAnalysis,
  type SpaceType,
  type SurfaceKind,
  type Treatment,
} from '../../shared/types';
import { findAsset, getMaterial, getPaint } from '../assets/catalog';
import { evictAssetImage } from '../engine/assetImages';
import { copyMaskInto, createMask, type MaskMode } from '../engine/mask';
import { generateAssetList, mergeGeneratedItems } from '../assetList/generate';
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

export type PanelId = 'surfaces' | 'paint' | 'materials' | 'lighting' | 'library' | 'assets' | 'ai';

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

export interface NewAssetItem extends Partial<Omit<AssetListItem, 'name' | 'category'>> {
  name: string;
  category: AssetListItem['category'];
}

export interface AppState {
  ready: boolean;
  projects: ProjectMeta[];
  project: Project | null;
  /** User-uploaded and AI-generated assets (global, all projects). */
  library: AssetDef[];
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
  saveState: 'idle' | 'saving' | 'saved' | 'error';
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

  // asset list
  addAssetItem(item: NewAssetItem): string | null;
  updateAssetItem(id: string, patch: Partial<Omit<AssetListItem, 'id'>>, opts?: MutateOptions): void;
  deleteAssetItem(id: string): void;
  setAssetList(items: AssetListItem[], label?: string): void;
  /** Rule-based regenerate (keeps manual/AI/locked rows). */
  regenerateAssetList(): Promise<void>;

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
    set({ saveState: 'saving' });
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow() {
    const p = get().project;
    if (!p) return;
    try {
      await db.saveProject(p);
      const meta = db.projectMeta(p);
      set((s) => ({
        saveState: 'saved',
        projects: [meta, ...s.projects.filter((m) => m.id !== meta.id)].sort((a, b) => b.updatedAt - a.updatedAt),
      }));
    } catch (err) {
      set({ saveState: 'error' });
      get().notify(`Could not save: ${(err as Error).message}`, 'error');
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
    saveState: 'idle',
    toasts: [],
    past: [],
    future: [],

    // ----------------------------------------------------------------- projects
    async init() {
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
      const p = await db.loadProject(id);
      if (!p) {
        get().notify('Project not found', 'error');
        return;
      }
      await runtime.clearRuntime();
      set({
        project: p,
        selection: firstSelection(p),
        past: [],
        future: [],
        maskVersions: {},
        placement: null,
        tool: 'select',
        saveState: 'idle',
        view: { ...get().view, mobilePane: 'editor', compare: 'off', showOriginal: false },
      });
    },

    async closeProject() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await saveNow();
      }
      await runtime.clearRuntime();
      set({ project: null, selection: EMPTY_SELECTION, past: [], future: [], placement: null });
    },

    async deleteProject(id) {
      if (get().project?.id === id) await get().closeProject();
      await db.deleteProject(id);
      set((s) => ({ projects: s.projects.filter((m) => m.id !== id) }));
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
        blobIds.push(ph.imageId, ph.thumbId, ...ph.designs.flatMap((d) => d.aiRenders.map((r) => r.imageId)));
        maskIds.push(...ph.regions.map((r) => r.maskId));
        runtime.forgetPhoto(ph.id);
      }
      runtime.forgetMasks(maskIds);
      const next = produce(p, (d) => {
        d.spaces = d.spaces.filter((s) => s.id !== id);
        d.assetList.forEach((item) => {
          item.spaceIds = item.spaceIds.filter((sid) => sid !== id);
        });
        d.updatedAt = Date.now();
      });
      // Deleting pixel data cannot be undone: clear history.
      set({ project: next, past: [], future: [], selection: firstSelection(next) });
      scheduleSave();
      await Promise.all([db.deleteBlobs(blobIds), db.deleteMasks(maskIds)]);
    },

    async addPhotos(spaceId, files) {
      const ids: string[] = [];
      for (const file of files) {
        try {
          const imported = await importImageFile(file);
          const photoId = newId('pho');
          const imageId = newId('img');
          const thumbId = newId('img');
          await Promise.all([db.putBlob(imageId, imported.blob), db.putBlob(thumbId, imported.thumb)]);
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
            designs: [design],
            activeDesignId: design.id,
          };
          get().mutateProject('Add photo', (d) => {
            d.spaces.find((s) => s.id === spaceId)?.photos.push(photo);
          }, { history: false });
          ids.push(photoId);
        } catch (err) {
          get().notify(`${file.name}: ${(err as Error).message}`, 'error');
        }
      }
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
      const blobIds = [photo.imageId, photo.thumbId, ...photo.designs.flatMap((d) => d.aiRenders.map((r) => r.imageId))];
      const maskIds = photo.regions.map((r) => r.maskId);
      runtime.forgetPhoto(photoId);
      runtime.forgetMasks(maskIds);
      const next = produce(p, (d) => {
        const sp = d.spaces.find((s) => s.id === space.id);
        if (sp) sp.photos = sp.photos.filter((ph) => ph.id !== photoId);
        d.updatedAt = Date.now();
      });
      const remaining = findSpace(next, space.id)?.photos ?? [];
      set({
        project: next,
        past: [],
        future: [],
        selection: { ...EMPTY_SELECTION, spaceId: space.id, photoId: remaining[0]?.id ?? null },
      });
      scheduleSave();
      await Promise.all([db.deleteBlobs(blobIds), db.deleteMasks(maskIds)]);
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
      const id = newId('ren');
      const imageId = newId('img');
      await db.putBlob(imageId, blob);
      const render: AIRender = { id, imageId, prompt, provider, createdAt: Date.now() };
      get().mutateProject('AI render', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void des.aiRenders.unshift(render)), { history: false });
      return id;
    },

    deleteAIRender(renderId) {
      const design = selectActiveDesign(get());
      const r = design?.aiRenders.find((x) => x.id === renderId);
      if (!r) return;
      get().mutateProject('Delete AI render', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => {
          des.aiRenders = des.aiRenders.filter((x) => x.id !== renderId);
        }), { history: false });
      void db.deleteBlobs([r.imageId]);
    },

    updateDesignNotes(notes) {
      get().mutateProject('Edit notes', (d) =>
        withActiveDesign(d, get().selection.photoId, (des) => void (des.notes = notes)), { coalesce: 'design-notes' });
    },

    // --------------------------------------------------------------- asset list
    addAssetItem(item) {
      if (!get().project) return null;
      const id = newId('itm');
      const row: AssetListItem = {
        quantity: 1,
        unit: 'each',
        spaceIds: [],
        source: 'manual',
        status: 'idea',
        locked: item.source === undefined || item.source === 'manual',
        createdAt: Date.now(),
        ...item,
        id,
      };
      get().mutateProject('Add list item', (d) => void d.assetList.push(row));
      return id;
    },

    updateAssetItem(id, patch, opts) {
      get().mutateProject('Edit list item', (d) => {
        const row = d.assetList.find((x) => x.id === id);
        if (!row) return;
        Object.assign(row, patch);
        // Hand-edits to generated rows must survive regeneration.
        const userFields: (keyof AssetListItem)[] = ['name', 'quantity', 'unit', 'unitCost', 'specs', 'category'];
        if (row.source === 'generated' && userFields.some((k) => k in patch) && patch.locked === undefined) row.locked = true;
      }, opts ?? { coalesce: `item:${id}` });
    },

    deleteAssetItem(id) {
      get().mutateProject('Delete list item', (d) => {
        d.assetList = d.assetList.filter((x) => x.id !== id);
      });
    },

    setAssetList(items, label = 'Update list') {
      get().mutateProject(label, (d) => {
        d.assetList = items as Draft<AssetListItem>[];
      });
    },

    async regenerateAssetList() {
      const p = get().project;
      if (!p) return;
      // Masks are needed for area estimates: load every region mask.
      await Promise.all(
        p.spaces.flatMap((s) => s.photos.flatMap((ph) => ph.regions.map((r) => runtime.loadMask(r.maskId, ph.width, ph.height)))),
      );
      const latest = get().project;
      if (!latest) return;
      const generated = generateAssetList({
        project: latest,
        getMask: runtime.getMask,
        getAsset: resolveAsset,
        getMaterial,
        getPaint,
      });
      get().setAssetList(mergeGeneratedItems(latest.assetList, generated), 'Regenerate list');
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
      set({ selection: { ...EMPTY_SELECTION, spaceId, photoId: sp?.photos[0]?.id ?? null }, placement: null });
    },

    selectPhoto(photoId) {
      const found = findPhoto(get().project, photoId);
      if (!found) return;
      set((s) => ({
        selection: { ...EMPTY_SELECTION, spaceId: found.space.id, photoId },
        placement: null,
        view: { ...s.view, mobilePane: 'editor', compare: 'off' },
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
      const before = get().project;
      if (!before) return;
      const after = produce(before, (d) => {
        recipe(d);
        d.updatedAt = Date.now();
      });
      if (after === before) return;
      const record = opts.history !== false;
      set((s) => {
        if (!record) return { project: after };
        const now = Date.now();
        const last = s.past[s.past.length - 1];
        if (opts.coalesce && last?.kind === 'project' && last.key === opts.coalesce && now - last.at < COALESCE_MS) {
          const merged: HistoryEntry = { ...last, after, at: now };
          return { project: after, past: [...s.past.slice(0, -1), merged], future: [] };
        }
        const entry: HistoryEntry = { kind: 'project', label, before, after, key: opts.coalesce, at: now };
        return { project: after, past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] };
      });
      scheduleSave();
    },

    recordMaskEdit(maskId, before, after, label = 'Edit mask') {
      const entry: HistoryEntry = { kind: 'mask', label, maskId, before, after, at: Date.now() };
      set((s) => ({ past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] }));
    },

    undo() {
      const { past, future, project } = get();
      const entry = past[past.length - 1];
      if (!entry) return;
      if (entry.kind === 'project') {
        if (!project) return;
        set({ project: entry.before, past: past.slice(0, -1), future: [entry, ...future] });
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
