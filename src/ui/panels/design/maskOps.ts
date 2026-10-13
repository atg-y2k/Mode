/**
 * Whole-mask operations offered on the selected surface (invert, grow,
 * shrink, feather, clear, select all). Each runs on a copy of the runtime
 * mask and commits through replaceMaskPixels, so it re-renders, persists
 * and is undoable as one step.
 */
import { clearMask, cloneMask, featherMask, fillMask, growMask, invertMask, isMaskEmpty, shrinkMask } from '../../../engine/mask';
import type { Mask } from '../../../engine/types';
import * as runtime from '../../../state/runtime';
import { replaceMaskPixels } from '../../../state/store';

export type MaskOpId = 'invert' | 'grow' | 'shrink' | 'feather' | 'clear' | 'fill';

export interface MaskOpDef {
  id: MaskOpId;
  label: string;
  /** Tooltip / accessible description. */
  title: string;
  /** Undo history label. */
  historyLabel: string;
  /** Only meaningful when something is outlined. */
  needsContent: boolean;
  apply: (m: Mask) => void;
}

/** Pixels grown / shrunk per click (photo px). */
export const GROW_STEP_PX = 2;
/** Feather blur radius (photo px). */
export const FEATHER_PX = 3;

export const MASK_OPS: readonly MaskOpDef[] = [
  {
    id: 'grow',
    label: `Grow ${GROW_STEP_PX} px`,
    title: 'Expand the outline slightly — closes thin gaps along edges',
    historyLabel: 'Grow outline',
    needsContent: true,
    apply: (m) => growMask(m, GROW_STEP_PX),
  },
  {
    id: 'shrink',
    label: `Shrink ${GROW_STEP_PX} px`,
    title: 'Pull the outline in slightly — removes spill onto neighbors',
    historyLabel: 'Shrink outline',
    needsContent: true,
    apply: (m) => shrinkMask(m, GROW_STEP_PX),
  },
  {
    id: 'feather',
    label: 'Feather',
    title: 'Soften the edge so the new finish blends in (good for hedges and lawns)',
    historyLabel: 'Feather outline',
    needsContent: true,
    apply: (m) => featherMask(m, FEATHER_PX),
  },
  {
    id: 'invert',
    label: 'Invert',
    title: 'Swap what is inside and outside the outline',
    historyLabel: 'Invert outline',
    needsContent: false,
    apply: invertMask,
  },
  {
    id: 'fill',
    label: 'Select all',
    title: 'Cover the whole photo, then subtract what you don’t want',
    historyLabel: 'Select whole photo',
    needsContent: false,
    apply: fillMask,
  },
  {
    id: 'clear',
    label: 'Clear',
    title: 'Remove the whole outline and start over',
    historyLabel: 'Clear outline',
    needsContent: true,
    apply: clearMask,
  },
];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Runs an operation on a region mask (loading it first when the editor has
 * not yet). Returns false when nothing changed (no history entry is made).
 */
export async function runMaskOp(op: MaskOpDef, maskId: string, width: number, height: number): Promise<boolean> {
  const mask = await runtime.loadMask(maskId, width, height);
  if (op.needsContent && isMaskEmpty(mask)) return false;
  const work = cloneMask(mask);
  op.apply(work);
  if (sameBytes(work.data, mask.data)) return false;
  replaceMaskPixels(maskId, work.data, op.historyLabel);
  return true;
}
