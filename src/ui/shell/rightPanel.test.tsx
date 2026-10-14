// @vitest-environment jsdom
/**
 * The desktop panel rail: a tab always shows its panel (a second click on the
 * current tab no longer hides it); only "Hide panel" hides the content, the
 * current tab stays selected meanwhile, and a hidden panel is not remembered
 * across reloads. Panels are stubbed.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../studio/panels/DesignPanel', () => ({ DesignPanel: () => <p>Design brief</p> }));
vi.mock('../studio/panels/ScenePanel', () => ({ ScenePanel: () => <p>Scene map</p> }));
vi.mock('../studio/panels/IdeasPanel', () => ({ IdeasPanel: () => <p>Idea board</p> }));
vi.mock('../studio/panels/SuggestionsPanel', () => ({ SuggestionsPanel: () => <p>Suggestions</p> }));
vi.mock('../studio/panels/HistoryPanel', () => ({ HistoryPanel: () => <p>History</p> }));
vi.mock('../panels/SurfacesPanel', () => ({ SurfacesPanel: () => null }));
vi.mock('../panels/PaintPanel', () => ({ PaintPanel: () => null }));
vi.mock('../panels/MaterialsPanel', () => ({ MaterialsPanel: () => null }));
vi.mock('../panels/LightingPanel', () => ({ LightingPanel: () => null }));
vi.mock('../panels/LibraryPanel', () => ({ LibraryPanel: () => null }));

const { useStore } = await import('../../state/store');
const { DesktopRightPanel } = await import('./RightPanel');
const { setPanelCollapsed, useShellUI } = await import('./shellUI');

const panel = () => document.getElementById('workspace-panel');
const tab = (name: string) => screen.getByRole('tab', { name });

beforeEach(() => {
  useStore.setState({ mode: 'studio', studio: { ...useStore.getState().studio, panel: 'design' } });
  setPanelCollapsed(false);
});
afterEach(() => cleanup());

describe('DesktopRightPanel', () => {
  it('keeps the panel open when the current tab is clicked again', () => {
    render(<DesktopRightPanel />);
    fireEvent.click(tab('Design'));
    fireEvent.click(tab('Design'));
    expect(panel()).toBeTruthy();
    expect(screen.getByText('Design brief')).toBeTruthy();
    expect(tab('Design').getAttribute('aria-selected')).toBe('true');
    expect(useShellUI.getState().panelCollapsed).toBe(false);
  });

  it('hides only with "Hide panel"; the current tab stays selected and shows the panel again', () => {
    render(<DesktopRightPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(panel()).toBeNull();
    expect(tab('Design').getAttribute('aria-selected')).toBe('true');
    expect(tab('Design').tabIndex).toBe(0);
    expect(tab('Design').hasAttribute('aria-controls')).toBe(false); // nothing to control while hidden

    fireEvent.click(tab('Design'));
    expect(panel()).toBeTruthy();
    expect(tab('Design').getAttribute('aria-controls')).toBe('workspace-panel');
  });

  it('another tab, by click or arrow key, shows its panel even when hidden', () => {
    render(<DesktopRightPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    fireEvent.click(tab('Ideas'));
    expect(screen.getByText('Idea board')).toBeTruthy();
    expect(tab('Ideas').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    fireEvent.keyDown(tab('Ideas'), { key: 'ArrowDown' });
    expect(screen.getByText('Suggestions')).toBeTruthy();
    expect(document.activeElement).toBe(tab('Suggest'));
  });

  it('does not remember a hidden panel on this device', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setPanelCollapsed(true);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
