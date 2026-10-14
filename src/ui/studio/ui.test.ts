import { describe, expect, it } from 'vitest';
import { useStore } from '../../state/store';
import { radioKeyTarget } from './PromptDock';
import { setStudioUI, toggleAreasOverlay, useStudioUI } from './ui';

describe('areas overlay over results', () => {
  it('a shown result is clean by default; Layers / [ ] add its areas without changing the original’s toggle', () => {
    useStore.getState().setStudio({ showZones: true });
    setStudioUI({ zonesOnResult: false });
    // Over a result: on, then off again — the original keeps its areas shown.
    toggleAreasOverlay(true);
    expect(useStudioUI.getState().zonesOnResult).toBe(true);
    expect(useStore.getState().studio.showZones).toBe(true);
    toggleAreasOverlay(true);
    expect(useStudioUI.getState().zonesOnResult).toBe(false);
    expect(useStore.getState().studio.showZones).toBe(true);
    // On the original: the usual toggle.
    toggleAreasOverlay(false);
    expect(useStore.getState().studio.showZones).toBe(false);
    // Asking for areas on a result while they are hidden everywhere turns both on.
    toggleAreasOverlay(true);
    expect(useStudioUI.getState().zonesOnResult).toBe(true);
    expect(useStore.getState().studio.showZones).toBe(true);
  });
});

describe('dock radio groups', () => {
  it('move with the arrow keys, Home and End like a native radio group', () => {
    expect(radioKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(radioKeyTarget('ArrowDown', 2, 3)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(radioKeyTarget('ArrowUp', 1, 3)).toBe(0);
    expect(radioKeyTarget('Home', 2, 3)).toBe(0);
    expect(radioKeyTarget('End', 0, 3)).toBe(2);
    expect(radioKeyTarget('Tab', 0, 3)).toBeNull();
    expect(radioKeyTarget('ArrowRight', 0, 0)).toBeNull();
  });
});
