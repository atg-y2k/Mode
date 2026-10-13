/**
 * Local-first storage in IndexedDB (via idb-keyval custom stores):
 *   projects  — Project JSON documents by id
 *   meta      — ProjectMeta by project id (fast listing without loading documents)
 *   blobs     — photos, thumbnails, AI renders, variations, idea images, uploaded asset images (Blob)
 *   masks     — RLE-encoded masks { width, height, rle: Uint8Array }
 *   library   — the user's custom / AI asset library (AssetDef[] under one key)
 * idb-keyval supports one object store per database, so each store is its own
 * database. Nothing leaves the device except explicit AI requests.
 */
import { createStore, del, delMany, get, getMany, keys, set, setMany, values, type UseStore } from 'idb-keyval';
import { z } from 'zod';
import { newId } from '../../shared/ids';
import {
  DEFAULT_LIGHTING,
  SPACE_TYPES,
  emptyBrief,
  spaceKindOf,
  type AssetDef,
  type Design,
  type DesignBrief,
  type ElementDimension,
  type Project,
  type ProjectMeta,
  type SpaceType,
} from '../../shared/types';
import { decodeMaskRLE, encodeMaskRLE } from '../engine/mask';
import type { Mask } from '../engine/types';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

type StoreName = 'projects' | 'meta' | 'blobs' | 'masks' | 'library';

const DATABASES: Record<StoreName, string> = {
  projects: 'mode-projects',
  meta: 'mode-project-meta',
  blobs: 'mode-blobs',
  masks: 'mode-masks',
  library: 'mode-library',
};

const storeCache = new Map<StoreName, UseStore>();

/** Lazily opened store (importing this module never touches IndexedDB). */
function store(name: StoreName): UseStore {
  let s = storeCache.get(name);
  if (!s) {
    if (typeof indexedDB === 'undefined') throw new Error('This browser has no IndexedDB storage (private mode?)');
    s = createStore(DATABASES[name], name);
    storeCache.set(name, s);
  }
  return s;
}

const LIBRARY_KEY = 'assets';

/** Mask record as stored in IndexedDB. */
interface StoredMask {
  width: number;
  height: number;
  rle: Uint8Array;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function projectMeta(project: Project): ProjectMeta {
  let photoCount = 0;
  let coverThumbId: string | undefined;
  for (const space of project.spaces) {
    photoCount += space.photos.length;
    if (!coverThumbId && space.photos.length) coverThumbId = space.photos[0].thumbId;
  }
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    spaceCount: project.spaces.length,
    photoCount,
    ...(coverThumbId ? { coverThumbId } : {}),
  };
}

/**
 * Lists projects from the meta index (newest first). Projects saved without a
 * meta record (older saves, interrupted writes) are indexed on the fly; meta
 * records whose project document is gone are dropped.
 */
export async function listProjects(): Promise<ProjectMeta[]> {
  const [projectIds, metas] = await Promise.all([keys<string>(store('projects')), values<ProjectMeta>(store('meta'))]);
  const ids = new Set(projectIds.map(String));
  const listed = new Map<string, ProjectMeta>();
  const orphans: string[] = [];
  for (const m of metas) {
    if (!m || typeof m.id !== 'string') continue;
    if (ids.has(m.id)) listed.set(m.id, m);
    else orphans.push(m.id);
  }
  const missing = [...ids].filter((id) => !listed.has(id));
  if (missing.length) {
    const docs = await getMany<unknown>(missing, store('projects'));
    const rebuilt: [string, ProjectMeta][] = [];
    docs.forEach((doc, i) => {
      if (!doc) return;
      try {
        const meta = projectMeta(migrateProject(doc));
        listed.set(missing[i], meta);
        rebuilt.push([missing[i], meta]);
      } catch (err) {
        console.warn(`[persistence] skipping unreadable project ${missing[i]}:`, err);
      }
    });
    if (rebuilt.length) await setMany(rebuilt, store('meta')).catch(() => undefined);
  }
  if (orphans.length) await delMany(orphans, store('meta')).catch(() => undefined);
  return [...listed.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await get<unknown>(id, store('projects'));
  if (!raw) return undefined;
  return migrateProject(raw);
}

export async function saveProject(project: Project): Promise<void> {
  // Document first: a missing meta record is rebuilt by listProjects, a missing document is not.
  await set(project.id, project, store('projects'));
  await set(project.id, projectMeta(project), store('meta'));
}

/** Deletes the project and every blob / mask it references. */
export async function deleteProject(id: string): Promise<void> {
  const raw = await get<unknown>(id, store('projects'));
  if (raw) {
    let refs: { blobIds: string[]; maskIds: string[] } = { blobIds: [], maskIds: [] };
    try {
      refs = referencedIds(migrateProject(raw));
    } catch (err) {
      console.warn(`[persistence] project ${id} is unreadable; deleting the document only`, err);
    }
    // Never delete images that a library asset still uses.
    const library = await loadLibrary().catch(() => [] as AssetDef[]);
    const keep = new Set(library.flatMap((a) => (a.imageId ? [a.imageId] : [])));
    const blobIds = refs.blobIds.filter((b) => !keep.has(b));
    await Promise.all([
      blobIds.length ? delMany(blobIds, store('blobs')) : undefined,
      refs.maskIds.length ? delMany(refs.maskIds, store('masks')) : undefined,
    ]);
  }
  await del(id, store('projects'));
  await del(id, store('meta'));
}

// ---------------------------------------------------------------------------
// Blobs & masks
// ---------------------------------------------------------------------------

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await set(id, blob, store('blobs'));
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const b = await get<unknown>(id, store('blobs'));
  return b instanceof Blob ? b : undefined;
}

export async function deleteBlobs(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length) await delMany(unique, store('blobs'));
}

export async function putMask(id: string, mask: Mask): Promise<void> {
  const record: StoredMask = { width: mask.width, height: mask.height, rle: encodeMaskRLE(mask) };
  await set(id, record, store('masks'));
}

/** Decoded mask, or undefined when missing or unreadable (callers then start from an empty mask). */
export async function getMask(id: string): Promise<Mask | undefined> {
  const rec = await get<StoredMask>(id, store('masks'));
  if (!rec || !(rec.rle instanceof Uint8Array)) return undefined;
  try {
    return decodeMaskRLE(rec.rle, rec.width, rec.height);
  } catch (err) {
    console.warn(`[persistence] mask ${id} is corrupt and was ignored`, err);
    return undefined;
  }
}

export async function deleteMasks(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length) await delMany(unique, store('masks'));
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export async function loadLibrary(): Promise<AssetDef[]> {
  const raw = await get<unknown>(LIBRARY_KEY, store('library'));
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is AssetDef => !!a && typeof a === 'object' && typeof (a as AssetDef).id === 'string');
}

export async function saveLibrary(assets: AssetDef[]): Promise<void> {
  await set(LIBRARY_KEY, assets, store('library'));
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

interface RefVisitor {
  /** Returns the (possibly new) id for a blob reference. */
  blob(id: string): string;
  mask(id: string): string;
}

/** Option visuals of kind 'image' point into the blob store. */
function visitDimensions(dims: ElementDimension[] | undefined, v: RefVisitor): void {
  for (const dim of dims ?? []) {
    for (const opt of dim.options ?? []) {
      const vis = opt.visual;
      if (vis?.kind === 'image' && vis.imageId) {
        const n = v.blob(vis.imageId);
        if (n !== vis.imageId) vis.imageId = n;
      }
    }
  }
}

function visitBrief(brief: DesignBrief | undefined, v: RefVisitor): void {
  for (const el of brief?.elements ?? []) visitDimensions(el.dimensions, v);
}

/**
 * Walks every blob / mask reference of a project. Assigns only when the
 * visitor returns a different id, so it is safe on frozen (immer) documents
 * with an identity visitor.
 */
function visitRefs(project: Project, v: RefVisitor): void {
  const swap = <T extends object, K extends keyof T>(obj: T, key: K, fn: (id: string) => string) => {
    const cur = obj[key];
    if (typeof cur !== 'string' || !cur) return;
    const n = fn(cur);
    if (n !== cur) obj[key] = n as T[K];
  };
  const blob = (id: string) => v.blob(id);
  const mask = (id: string) => v.mask(id);
  for (const space of project.spaces) {
    for (const photo of space.photos) {
      swap(photo, 'imageId', blob);
      swap(photo, 'thumbId', blob);
      for (const r of photo.regions) swap(r, 'maskId', mask);
      for (const z of photo.scene?.zones ?? []) swap(z, 'maskId', mask);
      for (const d of photo.designs) for (const r of d.aiRenders) swap(r, 'imageId', blob);
      for (const g of photo.generations) {
        for (const vr of g.variations) {
          swap(vr, 'imageId', blob);
          swap(vr, 'thumbId', blob);
        }
        visitBrief(g.brief, v);
      }
      visitBrief(photo.draft, v);
    }
  }
  for (const item of project.ideaBoard) {
    swap(item, 'imageId', blob);
    swap(item, 'thumbId', blob);
  }
}

/** Every blob id and mask id referenced by a project (photos, thumbs, renders, variations, idea images, region & zone masks). */
export function referencedIds(project: Project): { blobIds: string[]; maskIds: string[] } {
  const blobIds = new Set<string>();
  const maskIds = new Set<string>();
  visitRefs(project, {
    blob: (id) => (blobIds.add(id), id),
    mask: (id) => (maskIds.add(id), id),
  });
  return { blobIds: [...blobIds], maskIds: [...maskIds] };
}

// ---------------------------------------------------------------------------
// Migration (older saves → current model)
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

function migrateDesign(raw: unknown, index: number, now: number): Design {
  const d = isObj(raw) ? raw : {};
  return {
    ...(d as unknown as Design),
    id: str(d.id, '') || newId('dsg'),
    name: str(d.name, '') || `Option ${String.fromCharCode(65 + (index % 26))}`,
    createdAt: num(d.createdAt, now),
    updatedAt: num(d.updatedAt, now),
    treatments: isObj(d.treatments) ? (d.treatments as Design['treatments']) : {},
    hiddenRegionIds: arr<string>(d.hiddenRegionIds).filter((x) => typeof x === 'string'),
    objects: arr<Design['objects'][number]>(d.objects).filter(isObj),
    lights: arr<Design['lights'][number]>(d.lights).filter(isObj),
    lighting: { ...DEFAULT_LIGHTING, ...(isObj(d.lighting) ? (d.lighting as Partial<Design['lighting']>) : {}) },
    aiRenders: arr<Design['aiRenders'][number]>(d.aiRenders).filter((r) => isObj(r) && typeof r.imageId === 'string'),
  };
}

function migrateBrief(raw: unknown): DesignBrief {
  const b = isObj(raw) ? raw : {};
  const base = emptyBrief();
  return {
    ...base,
    ...(b as Partial<DesignBrief>),
    prompt: str(b.prompt, ''),
    elements: arr<DesignBrief['elements'][number]>(b.elements)
      .filter(isObj)
      .map((e) => ({
        ...e,
        zoneIds: arr<string>(e.zoneIds),
        pathIds: arr<string>(e.pathIds),
        dimensions: arr<ElementDimension>(e.dimensions).filter(isObj).map((dim) => ({ ...dim, options: arr(dim.options).filter(isObj) as unknown as ElementDimension['options'] })),
        choices: isObj(e.choices) ? e.choices : {},
        note: str(e.note, ''),
      })),
    ideaItemIds: arr<string>(b.ideaItemIds),
    targetZoneIds: arr<string>(b.targetZoneIds),
    plantMaturity: b.plantMaturity === 'new' || b.plantMaturity === 'mature' ? b.plantMaturity : 'established',
    scope: b.scope === 'whole' ? 'whole' : 'zones',
  };
}

/** Page-session start: runs created before it cannot still be rendering. */
const SESSION_START = Date.now();

/** A run left 'running' by a previous page session (tab closed mid-render) can never finish: settle it. */
function settleInterruptedRun(g: Loose): { status: string; error?: string } {
  const status = typeof g.status === 'string' ? g.status : 'done';
  if (status !== 'running' || num(g.createdAt, 0) >= SESSION_START) {
    return typeof g.error === 'string' ? { status, error: g.error } : { status };
  }
  return {
    status: arr(g.variations).length ? 'partial' : 'failed',
    error: typeof g.error === 'string' && g.error ? g.error : 'Interrupted — the app was closed while this run was rendering.',
  };
}

/**
 * Normalizes a stored or imported project document to the current model:
 * fills Studio fields added after the first release (ideaBoard, generations),
 * repairs missing arrays and a dangling activeDesignId. Never mutates `raw`.
 * Throws when the value is not a project at all.
 */
export function migrateProject(raw: unknown): Project {
  if (!isObj(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.spaces)) {
    throw new Error('Not a Mode project document');
  }
  const now = Date.now();
  const p = structuredClone(raw) as Loose;
  const spaces = arr<Loose>(p.spaces).filter(isObj).map((sp) => {
    const known = (SPACE_TYPES as readonly string[]).includes(str(sp.type, ''));
    const type = (known ? sp.type : sp.kind === 'exterior' ? 'other-exterior' : 'other-interior') as SpaceType;
    const photos = arr<Loose>(sp.photos).filter(isObj).map((ph) => {
      let designs = arr(ph.designs).map((d, i) => migrateDesign(d, i, now));
      if (!designs.length) designs = [migrateDesign({ name: 'Option A' }, 0, now)];
      const activeDesignId = designs.some((d) => d.id === ph.activeDesignId) ? (ph.activeDesignId as string) : designs[0].id;
      const generations = arr<Loose>(ph.generations).filter(isObj).map((g) => ({
        ...g,
        brief: migrateBrief(g.brief),
        variations: arr<Loose>(g.variations).filter((v) => isObj(v) && typeof v.imageId === 'string'),
        mode: g.mode === 'compare' ? 'compare' : 'variations',
        plan: str(g.plan, ''),
        provider: str(g.provider, ''),
        model: str(g.model, ''),
        ...settleInterruptedRun(g),
      }));
      const scene = isObj(ph.scene)
        ? { ...ph.scene, zones: arr(ph.scene.zones).filter(isObj).map((z) => ({ ...z, polygon: arr(z.polygon) })), paths: arr(ph.scene.paths).filter(isObj), keep: arr(ph.scene.keep), opportunities: arr(ph.scene.opportunities) }
        : undefined;
      const { scene: _scene, draft: _draft, ...rest } = ph;
      return {
        ...rest,
        name: str(ph.name, 'Photo'),
        createdAt: num(ph.createdAt, now),
        regions: arr<Loose>(ph.regions).filter((r) => isObj(r) && typeof r.maskId === 'string'),
        designs,
        activeDesignId,
        generations,
        ...(isObj(ph.draft) ? { draft: migrateBrief(ph.draft) } : {}),
        ...(scene ? { scene } : {}),
      };
    });
    return { ...sp, name: str(sp.name, 'Space'), type, kind: spaceKindOf(type), photos, createdAt: num(sp.createdAt, now) };
  });
  const ideaBoard = arr<Loose>(p.ideaBoard).filter(isObj).map((it) => ({
    ...it,
    id: str(it.id, '') || newId('idea'),
    kind: str(it.kind, 'note'),
    title: str(it.title, ''),
    note: str(it.note, ''),
    colors: arr<string>(it.colors).filter((c) => typeof c === 'string'),
    spaceIds: arr<string>(it.spaceIds),
    active: it.active !== false,
    createdAt: num(it.createdAt, now),
  }));
  return {
    ...p,
    id: p.id as string,
    version: 1,
    name: str(p.name, '').trim() ? (p.name as string) : 'My home',
    createdAt: num(p.createdAt, now),
    updatedAt: num(p.updatedAt, now),
    location: isObj(p.location) ? p.location : {},
    spaces,
    ideaBoard,
    assetList: arr(p.assetList),
  } as unknown as Project;
}

// ---------------------------------------------------------------------------
// Bundles (portable single-file backup)
// ---------------------------------------------------------------------------

export const BUNDLE_FORMAT = 'mode-project';
export const BUNDLE_VERSION = 1;

/** Standard base64 of raw bytes (chunked: no call-stack or string-length blowups on big photos). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x6000; // multiple of 3, so per-chunk base64 concatenates cleanly
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    let bin = '';
    for (let j = 0; j < sub.length; j++) bin += String.fromCharCode(sub[j]);
    parts.push(btoa(bin));
  }
  return parts.join('');
}

/** Inverse of bytesToBase64. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function blobToDataUrlString(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

/** Decodes a base64 data URL (header parsed separately: payloads can be many MB). */
function dataUrlToBlobSync(url: string): Blob {
  const marker = url.indexOf(';base64,');
  if (!url.startsWith('data:') || marker < 0) throw new Error('not a base64 data URL');
  const mime = url.slice(5, marker).split(';')[0].trim();
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream';
  return new Blob([base64ToBytes(url.slice(marker + 8))], { type });
}

/**
 * Portable single-file backup: JSON { format: 'mode-project', version: 1, project,
 * blobs: { id: dataURL }, masks: { id: { width, height, rle: base64 } }, library: AssetDef[] (assets used by the project) }.
 * Built from parts so a project with many images never becomes one giant string.
 */
export async function exportProjectBundle(project: Project, library: AssetDef[]): Promise<Blob> {
  const { blobIds, maskIds } = referencedIds(project);
  const libraryBlobIds = library.flatMap((a) => (a.imageId ? [a.imageId] : []));
  const allBlobIds = [...new Set([...blobIds, ...libraryBlobIds])];

  const parts: BlobPart[] = [];
  const header = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, app: 'Mode', exportedAt: new Date().toISOString() };
  parts.push(JSON.stringify(header).slice(0, -1));
  parts.push(`,"project":${JSON.stringify(project)}`);
  parts.push(`,"library":${JSON.stringify(library)}`);

  parts.push(',"blobs":{');
  let first = true;
  // Fetch in small batches: bounded memory, still few transactions.
  for (let i = 0; i < allBlobIds.length; i += 8) {
    const ids = allBlobIds.slice(i, i + 8);
    const blobs = await getMany<unknown>(ids, store('blobs'));
    for (let j = 0; j < ids.length; j++) {
      const b = blobs[j];
      if (!(b instanceof Blob)) continue;
      parts.push(`${first ? '' : ','}${JSON.stringify(ids[j])}:${JSON.stringify(await blobToDataUrlString(b))}`);
      first = false;
    }
  }
  parts.push('},"masks":{');
  first = true;
  const masks = maskIds.length ? await getMany<StoredMask>(maskIds, store('masks')) : [];
  masks.forEach((rec, i) => {
    if (!rec || !(rec.rle instanceof Uint8Array)) return;
    const entry = { width: rec.width, height: rec.height, rle: bytesToBase64(rec.rle) };
    parts.push(`${first ? '' : ','}${JSON.stringify(maskIds[i])}:${JSON.stringify(entry)}`);
    first = false;
  });
  parts.push('}}');
  return new Blob(parts, { type: 'application/json' });
}

// Structural validation of imported bundles. Loose objects: unknown fields are
// kept (forward compatible); only what the app needs to not crash is checked.
const zId = z.string().min(1).max(200);
const zLoose = z.looseObject({});
const zRegion = z.looseObject({ id: zId, maskId: zId });
const zDesign = z.looseObject({ id: zId });
const zVariation = z.looseObject({ id: zId, imageId: zId, thumbId: zId });
const zGeneration = z.looseObject({ id: zId, variations: z.array(zVariation).optional() });
const zZone = z.looseObject({ id: zId, maskId: zId.optional() });
const zScene = z.looseObject({ zones: z.array(zZone).optional() });
const zPhoto = z.looseObject({
  id: zId,
  imageId: zId,
  thumbId: zId,
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  regions: z.array(zRegion),
  designs: z.array(zDesign).optional(),
  generations: z.array(zGeneration).optional(),
  scene: zScene.optional(),
});
const zSpace = z.looseObject({ id: zId, name: z.string(), type: z.string(), photos: z.array(zPhoto) });
const zIdea = z.looseObject({ id: zId, imageId: zId.optional(), thumbId: zId.optional() });
const zProject = z.looseObject({
  id: zId,
  name: z.string(),
  spaces: z.array(zSpace),
  ideaBoard: z.array(zIdea).optional(),
});
const zAsset = z.looseObject({
  id: zId,
  name: z.string(),
  category: z.string(),
  aspect: z.number().positive(),
  realHeightFt: z.number().nonnegative(),
  imageId: zId.optional(),
});
const zBundle = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.number().int().positive(),
  project: zProject,
  blobs: z.record(z.string(), z.string()).optional(),
  masks: z.record(z.string(), z.object({ width: z.number().int().positive(), height: z.number().int().positive(), rle: z.string() })).optional(),
  library: z.array(zLoose).optional(),
});

function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, k) => (typeof k === 'number' ? `${acc}[${k}]` : acc ? `${acc}.${String(k)}` : String(k)), '');
}

/** Parses and validates a bundle file, with messages a user can act on. */
async function parseBundle(file: Blob): Promise<z.infer<typeof zBundle>> {
  if (file.size === 0) throw new Error('The file is empty.');
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("This file isn't a Mode project backup (it is not valid JSON).");
  }
  if (!isObj(json) || json.format !== BUNDLE_FORMAT) {
    throw new Error("This file isn't a Mode project backup (expected a .mode.json file exported from Mode).");
  }
  if (typeof json.version === 'number' && json.version > BUNDLE_VERSION) {
    throw new Error('This backup was made by a newer version of Mode. Update the app and try again.');
  }
  const parsed = zBundle.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? issuePath(issue.path) : '';
    throw new Error(`The backup is damaged or incomplete${where ? ` (at ${where}: ${issue.message})` : ''}.`);
  }
  return parsed.data;
}

/**
 * Imports a bundle as a NEW project (fresh project id; blob/mask ids remapped
 * so importing twice never collides). Returns the saved project and any
 * library assets it carried (also merged into the stored library).
 * Pixel data is written first and the project document last, so a failed
 * import never leaves a half-loaded project behind.
 */
export async function importProjectBundle(file: Blob): Promise<{ project: Project; library: AssetDef[] }> {
  const bundle = await parseBundle(file);
  const project = migrateProject(bundle.project);
  const blobData = bundle.blobs ?? {};
  const maskData = bundle.masks ?? {};

  // Fresh ids for everything that lives in the shared blob / mask stores.
  const blobMap = new Map<string, string>();
  const maskMap = new Map<string, string>();
  const mapBlob = (id: string) => {
    let n = blobMap.get(id);
    if (!n) blobMap.set(id, (n = newId('img')));
    return n;
  };
  const mapMask = (id: string) => {
    let n = maskMap.get(id);
    if (!n) maskMap.set(id, (n = newId('msk')));
    return n;
  };
  visitRefs(project, { blob: mapBlob, mask: mapMask });

  // Library assets: keep the stored copy when the id is already known.
  const stored = await loadLibrary();
  const storedById = new Map(stored.map((a) => [a.id, a]));
  const carried: AssetDef[] = [];
  const added: AssetDef[] = [];
  for (const raw of bundle.library ?? []) {
    const ok = zAsset.safeParse(raw);
    if (!ok.success) continue; // a broken library entry must not block the project
    const asset = structuredClone(ok.data) as unknown as AssetDef;
    const existing = storedById.get(asset.id);
    if (existing) {
      carried.push(existing);
      continue;
    }
    if (asset.imageId) asset.imageId = mapBlob(asset.imageId);
    carried.push(asset);
    added.push(asset);
    storedById.set(asset.id, asset);
  }

  const blobEntries: [string, Blob][] = [];
  for (const [oldId, newBlobId] of blobMap) {
    const url = blobData[oldId];
    if (typeof url !== 'string') continue;
    try {
      blobEntries.push([newBlobId, dataUrlToBlobSync(url)]);
    } catch {
      console.warn(`[persistence] import: image ${oldId} is unreadable and was skipped`);
    }
  }
  const maskEntries: [string, StoredMask][] = [];
  for (const [oldId, newMaskId] of maskMap) {
    const rec = maskData[oldId];
    if (!rec) continue;
    try {
      const rle = base64ToBytes(rec.rle);
      decodeMaskRLE(rle, rec.width, rec.height); // validate before storing
      maskEntries.push([newMaskId, { width: rec.width, height: rec.height, rle }]);
    } catch {
      console.warn(`[persistence] import: mask ${oldId} is corrupt and was skipped`);
    }
  }

  const metas = await listProjects().catch(() => [] as ProjectMeta[]);
  const name = metas.some((m) => m.name === project.name) ? `${project.name} (imported)` : project.name;
  const imported: Project = { ...project, id: newId('prj'), name, updatedAt: Date.now() };

  const written = { blobs: [] as string[], masks: [] as string[] };
  try {
    // Small batches keep each transaction (and its memory) bounded.
    for (let i = 0; i < blobEntries.length; i += 8) {
      const batch = blobEntries.slice(i, i + 8);
      await setMany(batch, store('blobs'));
      written.blobs.push(...batch.map(([id]) => id));
    }
    if (maskEntries.length) {
      await setMany(maskEntries, store('masks'));
      written.masks.push(...maskEntries.map(([id]) => id));
    }
    if (added.length) await saveLibrary([...stored, ...added]);
    await saveProject(imported);
  } catch (err) {
    await Promise.all([deleteBlobs(written.blobs), deleteMasks(written.masks)]).catch(() => undefined);
    const msg = (err as Error)?.name === 'QuotaExceededError' ? 'Not enough storage space on this device.' : (err as Error)?.message;
    throw new Error(`Could not save the imported project: ${msg}`);
  }
  return { project: imported, library: carried };
}

// ---------------------------------------------------------------------------
// Storage housekeeping
// ---------------------------------------------------------------------------

/** Asks the browser not to evict our data (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const sm = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!sm?.persist) return false;
    if (await sm.persisted?.()) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}
