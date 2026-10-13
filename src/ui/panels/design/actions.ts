/**
 * Store actions used by the Surfaces / Paint / Materials panels, wrapped with
 * the guidance the flow needs ("1. add a surface → 2. outline it → 3. pick a
 * finish"). Every document edit goes through the store's actions.
 */
import { newId } from '../../../../shared/ids';
import { SURFACE_LABELS, type SurfaceKind, type Treatment } from '../../../../shared/types';
import { selectActivePhoto, useStore, type ToolId } from '../../../state/store';
import { showPhotoOnPhone } from './hooks';
import { surfaceNoun } from './surfaceKinds';

export function selectRegion(regionId: string): void {
  useStore.getState().select({ regionId, objectId: null, lightId: null });
}

/**
 * Step 1 → 2: creates a surface on the active photo, selects it and arms the
 * smart brush (on phones the photo comes forward so the user can brush right away).
 */
export function addSurface(surface: SurfaceKind): string | null {
  const s = useStore.getState();
  const photo = selectActivePhoto(s);
  if (!photo) {
    s.notify('Open a photo of this space first.', 'info');
    return null;
  }
  const isFirst = photo.regions.length === 0;
  const id = s.addRegion(surface);
  if (!id) return null;
  s.setTool('smart-brush');
  s.setToolOptions({ maskMode: 'add' });
  showPhotoOnPhone();
  if (isFirst) {
    s.notify(`Now brush over the ${surfaceNoun(surface)} in the photo — the smart brush sticks to its color.`, 'info');
  } else {
    const name = selectActivePhoto(useStore.getState())?.regions.find((r) => r.id === id)?.name ?? SURFACE_LABELS[surface];
    s.notify(`Added “${name}”. Brush over it in the photo to outline it.`, 'info');
  }
  return id;
}

/** Switch to a canvas tool (on phones the shell brings the photo forward). */
export function activateCanvasTool(tool: ToolId): void {
  const s = useStore.getState();
  s.setTool(tool);
  showPhotoOnPhone();
}

/** Opens the Paint or Materials panel for a region. */
export function openFinishPanel(regionId: string, panel: 'paint' | 'materials'): void {
  selectRegion(regionId);
  useStore.getState().setPanel(panel);
}

/** Applies a treatment to several regions of the active photo as a single undo step. */
export function applyTreatmentToRegions(regionIds: readonly string[], treatment: Treatment): void {
  const s = useStore.getState();
  const key = `panel:apply-all:${newId()}`;
  for (const id of regionIds) s.setTreatment(id, { ...treatment }, { coalesce: key });
}
