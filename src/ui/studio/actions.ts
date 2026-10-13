/**
 * Viewer actions that combine store operations: targeting zones and paths
 * from the photo, turning sketches into scene paths / zones, choosing a
 * compared option, downloading and deleting variations.
 */
import type { Draft } from 'immer';
import { newId } from '../../../shared/ids';
import {
  SPACE_TYPE_LABELS,
  type DesignBrief,
  type ElementSpec,
  type Generation,
  type Photo,
  type Pt,
  type SceneMap,
  type Space,
  type Variation,
} from '../../../shared/types';
import { feasibilityContext, newElementSpec } from '../../assets/design';
import { downloadBlob } from '../../lib/imageImport';
import * as db from '../../state/persistence';
import { findPhoto, useStore } from '../../state/store';
import { polygonArea } from './geometry';
import { cancelRun, errorMessage, isRunActive, startRun, type StartRunOptions } from './generate';
import { compareContext } from './tiles';

const store = () => useStore.getState();

/** The element the Design panel has open, when it is still in the photo's brief. */
export function activeElement(photo: Photo | undefined, activeElementId: string | null): ElementSpec | undefined {
  if (!photo?.draft || !activeElementId) return undefined;
  return photo.draft.elements.find((e) => e.id === activeElementId);
}

/** Zone ids the brief targets (explicitly or through an element). */
export function targetedZoneIds(brief: DesignBrief | undefined): Set<string> {
  const ids = new Set<string>(brief?.targetZoneIds ?? []);
  for (const el of brief?.elements ?? []) for (const id of el.zoneIds) ids.add(id);
  return ids;
}

export function targetedPathIds(brief: DesignBrief | undefined): Set<string> {
  const ids = new Set<string>();
  for (const el of brief?.elements ?? []) for (const id of el.pathIds) ids.add(id);
  return ids;
}

function toggle(list: Draft<string[]>, id: string): boolean {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
  return i < 0;
}

/**
 * Click on a zone: toggles it in the open element's "where" when an element
 * is open in the Design panel, else in the brief's target areas.
 */
export function toggleZoneTarget(photo: Photo, zoneId: string): void {
  const s = store();
  const zone = photo.scene?.zones.find((z) => z.id === zoneId);
  if (!zone) return;
  const el = activeElement(photo, s.studio.activeElementId);
  let added = false;
  s.updateDraft(photo.id, (d) => {
    const target = el ? d.elements.find((e) => e.id === el.id) : undefined;
    if (target) added = toggle(target.zoneIds, zoneId);
    else {
      added = toggle(d.targetZoneIds, zoneId);
      // Un-targeting an area also takes it out of elements that used it,
      // so the area really stops changing.
      if (!added) for (const e of d.elements) e.zoneIds = e.zoneIds.filter((id) => id !== zoneId);
    }
  }, {});
  if (!zone.editable && added) s.notify(`“${zone.label}” is usually left as is — it will change only if your brief asks for it.`, 'info');
}

/**
 * Click on a path: toggles it in the open element; otherwise opens the
 * Pathway element that already uses it, or adds a Pathway along it.
 */
export function activatePath(photo: Photo, space: Space | undefined, pathId: string): void {
  const s = store();
  const path = photo.scene?.paths.find((p) => p.id === pathId);
  if (!path) return;
  const el = activeElement(photo, s.studio.activeElementId);
  if (el) {
    s.updateDraft(photo.id, (d) => {
      const target = d.elements.find((e) => e.id === el.id);
      if (target) toggle(target.pathIds, pathId);
    }, {});
    return;
  }
  const using = photo.draft?.elements.find((e) => e.pathIds.includes(pathId));
  if (using) {
    openElement(using.id);
    return;
  }
  addPathwayFor(photo, space, pathId);
}

/** Opens an element card in the Design panel (phones: switches to the panel). */
export function openElement(elementId: string): void {
  const s = store();
  s.setStudio({ panel: 'design', activeElementId: elementId });
  if (typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 64rem)').matches) s.setView({ mobilePane: 'panel' });
}

function addPathwayFor(photo: Photo, space: Space | undefined, pathId: string): void {
  const s = store();
  const existing = photo.draft?.elements.find((e) => e.type === 'pathway');
  if (existing) {
    s.updateDraft(photo.id, (d) => {
      const target = d.elements.find((e) => e.id === existing.id);
      if (target && !target.pathIds.includes(pathId)) target.pathIds.push(pathId);
    }, {});
    openElement(existing.id);
    return;
  }
  const scene = findPhoto(s.project, photo.id)?.photo.scene;
  const ctx = feasibilityContext(s.project?.location, [], space?.kind ?? 'exterior');
  const spec = newElementSpec('pathway', scene, ctx);
  spec.pathIds = [pathId];
  spec.zoneIds = [];
  s.updateDraft(photo.id, (d) => void d.elements.push(spec), {});
  openElement(spec.id);
  s.notify('Added a Pathway along that route — pick its stones, shape and width in Design.', 'success');
}

function emptyScene(space: Space | undefined): SceneMap {
  return {
    category: space?.type ?? 'other-exterior',
    summary: '',
    viewpoint: '',
    style: '',
    boundaries: '',
    lighting: '',
    orientation: '',
    architecture: { style: '', features: [], materials: [], proportions: '', designLanguage: [], purpose: [] },
    zones: [],
    paths: [],
    keep: [],
    opportunities: [],
    createdAt: Date.now(),
    model: 'manual',
  };
}

/** Sketches need a scene map to live in: start an empty one (no AI) when the photo has none. */
function ensureScene(photo: Photo, space: Space | undefined): void {
  if (!photo.scene) store().setScene(photo.id, emptyScene(space));
}

function nextLabel(base: string, labels: readonly string[]): string {
  if (!labels.includes(base)) return base;
  let n = 2;
  while (labels.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Clockwise (screen space) copy of a polygon. */
function clockwise(points: Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...points].reverse() : points;
}

/** A drawn area becomes a zone ("Sketched area") targeted by the open element or the brief. */
export function addSketchedArea(photo: Photo, space: Space | undefined, polygon: Pt[]): string | null {
  if (polygon.length < 3 || polygonArea(polygon) < 16) return null;
  const s = store();
  ensureScene(photo, space);
  const id = newId('zone');
  const labels = findPhoto(s.project, photo.id)?.photo.scene?.zones.map((z) => z.label) ?? [];
  const label = nextLabel('Sketched area', labels);
  s.updateScene(photo.id, (scene) => {
    scene.zones.push({ id, kind: 'other', label, description: 'Area outlined by the homeowner on the photo', polygon: clockwise(polygon.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))), editable: true });
  }, {});
  const el = activeElement(findPhoto(store().project, photo.id)?.photo, s.studio.activeElementId);
  s.updateDraft(photo.id, (d) => {
    const target = el ? d.elements.find((e) => e.id === el.id) : undefined;
    if (target) target.zoneIds.push(id);
    else d.targetZoneIds.push(id);
  }, {});
  s.notify(el ? `${label} added to ${el.label}.` : `${label} added to the areas that may change.`, 'success');
  return id;
}

/** A drawn centerline becomes a scene path (kind 'sketch') used by the open element or a Pathway. */
export function addSketchedPath(photo: Photo, space: Space | undefined, points: Pt[], widthPx: number): string | null {
  if (points.length < 2) return null;
  const s = store();
  ensureScene(photo, space);
  const id = newId('path');
  const labels = findPhoto(s.project, photo.id)?.photo.scene?.paths.map((p) => p.label) ?? [];
  const label = nextLabel('Sketched path', labels);
  s.updateScene(photo.id, (scene) => {
    scene.paths.push({
      id,
      label,
      from: '',
      to: '',
      description: '',
      points: points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      widthPx: Math.max(4, Math.round(widthPx)),
      kind: 'sketch',
    });
  }, {});
  const fresh = findPhoto(store().project, photo.id)?.photo ?? photo;
  activatePath(fresh, space, id);
  return id;
}

export function setPathWidth(photoId: string, pathId: string, widthPx: number): void {
  store().updateScene(photoId, (scene) => {
    const p = scene.paths.find((x) => x.id === pathId);
    if (p) p.widthPx = Math.max(4, Math.round(widthPx));
  }, { coalesce: `path-width:${pathId}` });
}

export function movePathPoint(photoId: string, pathId: string, index: number, pt: Pt): void {
  store().updateScene(photoId, (scene) => {
    const p = scene.paths.find((x) => x.id === pathId);
    if (p && p.points[index]) p.points[index] = { x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10 };
  }, { coalesce: `path-point:${pathId}:${index}` });
}

export function deleteScenePath(photo: Photo, pathId: string): void {
  const s = store();
  s.updateScene(photo.id, (scene) => {
    scene.paths = scene.paths.filter((p) => p.id !== pathId);
  }, {});
  s.updateDraft(photo.id, (d) => {
    for (const e of d.elements) e.pathIds = e.pathIds.filter((id) => id !== pathId);
  }, {});
}

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

export function viewVariation(variationId: string | null): void {
  store().setStudio({ viewVariationId: variationId, gridGenerationId: null });
}

/** Compare grid "Choose": sets the brief's choice to the variation's option and shows it. */
export function chooseCompareOption(photo: Photo, g: Generation, v: Variation): void {
  const s = store();
  const ctx = compareContext(g);
  if (!ctx || !g.compare || !v.optionId) {
    viewVariation(v.id);
    return;
  }
  const { elementId, dimensionId } = g.compare;
  const optionId = v.optionId;
  const inDraft = photo.draft?.elements.find((e) => e.id === elementId);
  if (inDraft) {
    s.updateDraft(photo.id, (d) => {
      const el = d.elements.find((e) => e.id === elementId);
      if (!el) return;
      el.choices[dimensionId] = [optionId];
      // Tailored options may only live in the run's snapshot: bring the option along.
      const dim = el.dimensions.find((x) => x.id === dimensionId);
      const option = ctx.options.find((o) => o.id === optionId);
      if (dim && option && !dim.options.some((o) => o.id === optionId)) dim.options.push(structuredClone(option));
    }, {});
    s.notify(`${ctx.dimensionLabel}: ${v.optionLabel ?? 'option'} chosen for ${inDraft.label}.`, 'success');
  } else {
    s.notify(`${ctx.elementLabel} is no longer in the brief — showing the variation.`, 'info');
  }
  viewVariation(v.id);
}

function safeName(text: string): string {
  return text.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'variation';
}

export async function downloadVariation(v: Variation): Promise<void> {
  const s = store();
  const blob = await db.getBlob(v.imageId);
  if (!blob) {
    s.notify('That image is missing from storage.', 'error');
    return;
  }
  const project = s.project ? safeName(s.project.name) : 'mode';
  downloadBlob(blob, `${project}-${safeName(v.title)}.jpg`);
}

export async function downloadOriginal(photo: Photo): Promise<void> {
  const blob = await db.getBlob(photo.imageId);
  if (blob) downloadBlob(blob, `${safeName(photo.name)}.jpg`);
}

export async function deleteRun(photoId: string, generationId: string): Promise<void> {
  if (isRunActive(generationId)) cancelRun(generationId);
  await store().deleteGeneration(photoId, generationId);
}

/** Starts a run, reporting a refusal (empty brief, no provider…) as a toast. */
export async function runOrNotify(opts: StartRunOptions): Promise<string | null> {
  try {
    return await startRun(opts);
  } catch (err) {
    store().notify(errorMessage(err), 'error');
    return null;
  }
}

/** Short label of a photo's setting for prompts and microcopy. */
export function spaceLabel(space: Space | undefined): string {
  return space ? SPACE_TYPE_LABELS[space.type] : 'Photo';
}
