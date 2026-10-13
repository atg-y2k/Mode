/**
 * Local-first storage in IndexedDB (via idb-keyval custom stores):
 *   projects  — Project JSON documents by id
 *   blobs     — photos, thumbnails, AI renders, uploaded asset images (Blob)
 *   masks     — RLE-encoded masks { width, height, rle: Uint8Array }
 *   library   — the user's custom / AI asset library (AssetDef[] under one key)
 * Nothing leaves the device except explicit AI requests.
 */
import type { AssetDef, Project, ProjectMeta } from '../../shared/types';
import type { Mask } from '../engine/types';

export declare function listProjects(): Promise<ProjectMeta[]>;
export declare function loadProject(id: string): Promise<Project | undefined>;
export declare function saveProject(project: Project): Promise<void>;
/** Deletes the project and every blob / mask it references. */
export declare function deleteProject(id: string): Promise<void>;
export declare function projectMeta(project: Project): ProjectMeta;

export declare function putBlob(id: string, blob: Blob): Promise<void>;
export declare function getBlob(id: string): Promise<Blob | undefined>;
export declare function deleteBlobs(ids: string[]): Promise<void>;

export declare function putMask(id: string, mask: Mask): Promise<void>;
export declare function getMask(id: string): Promise<Mask | undefined>;
export declare function deleteMasks(ids: string[]): Promise<void>;

export declare function loadLibrary(): Promise<AssetDef[]>;
export declare function saveLibrary(assets: AssetDef[]): Promise<void>;

/** Every blob id and mask id referenced by a project (photos, thumbs, renders, region masks). */
export declare function referencedIds(project: Project): { blobIds: string[]; maskIds: string[] };

/**
 * Portable single-file backup: JSON { format: 'mode-project', version: 1, project,
 * blobs: { id: dataURL }, masks: { id: { width, height, rle: base64 } }, library: AssetDef[] (assets used by the project) }.
 */
export declare function exportProjectBundle(project: Project, library: AssetDef[]): Promise<Blob>;

/**
 * Imports a bundle as a NEW project (fresh project id; blob/mask ids remapped
 * so importing twice never collides). Returns the saved project and any
 * library assets it carried (also merged into the stored library).
 */
export declare function importProjectBundle(file: Blob): Promise<{ project: Project; library: AssetDef[] }>;

/** Asks the browser not to evict our data (best effort). */
export declare function requestPersistentStorage(): Promise<boolean>;
