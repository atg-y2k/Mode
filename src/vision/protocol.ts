/**
 * Messages between the vision client (main thread, ./index.ts) and the
 * model worker (./worker.ts). Every request carries an `id`; the worker
 * answers with exactly one `result` for it, may send `progress` for it
 * before, and broadcasts `status` whenever its state changes.
 */
import type { Pt, SpaceType, ZoneKind } from '../../shared/types';
import type { Backend, ModelKey } from './models';
import type { Box } from './prompts';
import type { OfflineZone } from './sceneFromClasses';

export interface PromptInput {
  positive: Pt[];
  negative?: Pt[];
  box?: Box;
}

export interface RefineZoneInput {
  id: string;
  kind: ZoneKind;
  polygon: Pt[];
}

export interface RefineZoneResult {
  zoneId: string;
  /** False when no candidate matched the outline well enough — keep the AI outline. */
  refined: boolean;
  /** Coverage mask at photo size (only when refined). */
  mask?: Uint8Array;
  polygon?: Pt[];
  /** 0..1, see scoring.zoneAgreement. */
  agreement: number;
  /** IoU between the chosen mask and the original outline. */
  iou: number;
  /** Share of the mask in the zone kind's ADE20K classes (null = not checked). */
  classShare: number | null;
}

export type WorkerRequest =
  | { id: number; op: 'init'; prefer: 'auto' | 'wasm' }
  | { id: number; op: 'cached'; models: ModelKey[] }
  | { id: number; op: 'setImage'; photoId: string; width: number; height: number; data: Uint8ClampedArray }
  | { id: number; op: 'encode'; photoId: string }
  | { id: number; op: 'segment'; photoId: string; prompt: PromptInput; maxSize?: number }
  | { id: number; op: 'refine'; photoId: string; zones: RefineZoneInput[]; context: RefineZoneInput[] }
  | { id: number; op: 'offlineMap'; photoId: string; interior: boolean }
  | { id: number; op: 'kindOf'; photoId: string; mask: Uint8Array; width: number; height: number; interior: boolean }
  | { id: number; op: 'forget'; photoId: string };

export type WorkerOp = WorkerRequest['op'];

export interface InitResult {
  backend: Backend;
  f16: boolean;
  threads: number;
}

export interface SegmentResult {
  width: number;
  height: number;
  mask: Uint8Array;
  /** Decoder's predicted IoU of the chosen candidate. */
  score: number;
  /** Decode time in ms (drives the hover-preview decision). */
  ms: number;
}

export interface OfflineMapResult {
  zones: OfflineZone[];
  category: SpaceType;
  usedClip: boolean;
}

export interface WorkerStatus {
  stage: 'idle' | 'downloading' | 'encoding' | 'ready' | 'error';
  progress?: number;
  backend?: Backend;
  message?: string;
  loadedBytes?: number;
  totalBytes?: number;
}

export type WorkerMessage =
  | { type: 'status'; status: WorkerStatus }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; ok: true; data: unknown }
  | { type: 'result'; id: number; ok: false; error: string; code?: 'no-image' | 'unsupported' | 'network' | 'memory' };
