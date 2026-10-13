/**
 * Viewer-local UI state shared by the Studio components (not part of the
 * document, not persisted): before/after slider, the sketched path being
 * adjusted, the refine prompt target, and the delete confirmation.
 */
import { create } from 'zustand';

export interface StudioUIState {
  /** Before/after slider over the original (when a variation is shown). */
  slider: boolean;
  /** Divider position as a fraction of the photo width. */
  sliderPos: number;
  /** Sketched path whose width / points are being adjusted. */
  editingPathId: string | null;
  /** Variation whose "Refine" input is open. */
  refineId: string | null;
  /** Pending destructive action awaiting confirmation. */
  confirm: { kind: 'variation' | 'run'; photoId: string; id: string; title: string } | null;
}

export const useStudioUI = create<StudioUIState>()(() => ({
  slider: false,
  sliderPos: 0.5,
  editingPathId: null,
  refineId: null,
  confirm: null,
}));

export const setStudioUI = (patch: Partial<StudioUIState>): void => useStudioUI.setState(patch);
