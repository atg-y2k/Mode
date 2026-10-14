/**
 * Viewer-local UI state shared by the Studio components (not part of the
 * document, not persisted): before/after slider, the sketched path being
 * adjusted, the info card's detail state, the delete confirmation, the
 * starting image the owner chose for the next runs and whether a shown
 * result carries the areas overlay.
 */
import { create } from 'zustand';
import { useStore } from '../../state/store';

export interface StudioUIState {
  /** Before/after slider over the original (when a variation is shown). */
  slider: boolean;
  /** Divider position as a fraction of the photo width. */
  sliderPos: number;
  /** Sketched path whose width / points are being adjusted. */
  editingPathId: string | null;
  /** The viewer's info card shows the plan, plants and instruction. */
  infoExpanded: boolean;
  /** Pending destructive action awaiting confirmation. */
  confirm: { kind: 'variation' | 'run'; photoId: string; id: string; title: string } | null;
  /**
   * Variation the next runs start from — set only by "Use as base" / History
   * "Branch" (viewing a result never makes it the starting image). Null: the
   * original photo.
   */
  baseVariationId: string | null;
  /** The areas overlay over a shown result (off by default: results are seen clean; the original keeps store.studio.showZones). */
  zonesOnResult: boolean;
}

export const useStudioUI = create<StudioUIState>()(() => ({
  slider: false,
  sliderPos: 0.5,
  editingPathId: null,
  infoExpanded: false,
  confirm: null,
  baseVariationId: null,
  zonesOnResult: false,
}));

export const setStudioUI = (patch: Partial<StudioUIState>): void => useStudioUI.setState(patch);

/**
 * The areas overlay toggle (Layers button, [ or ]): on the original photo it
 * shows / hides the editable areas; over a shown result it adds or removes
 * them on the result only (results are shown clean by default).
 */
export function toggleAreasOverlay(onResult: boolean): void {
  const s = useStore.getState();
  if (!onResult) {
    s.setStudio({ showZones: !s.studio.showZones });
    return;
  }
  const shown = s.studio.showZones && useStudioUI.getState().zonesOnResult;
  setStudioUI({ zonesOnResult: !shown });
  if (!shown && !s.studio.showZones) s.setStudio({ showZones: true });
}

let baseResetInstalled = false;

/**
 * The chosen starting image belongs to one photo of one open project:
 * selecting another photo, or opening a project, goes back to the original.
 * Installed once by the Studio; it keeps watching while the Studio is
 * unmounted (Fine-tune, phone panes).
 */
export function installBaseReset(): void {
  if (baseResetInstalled) return;
  baseResetInstalled = true;
  useStore.subscribe((s, prev) => {
    if (s.selection.photoId === prev.selection.photoId && s.project?.id === prev.project?.id) return;
    if (useStudioUI.getState().baseVariationId) setStudioUI({ baseVariationId: null });
  });
}
