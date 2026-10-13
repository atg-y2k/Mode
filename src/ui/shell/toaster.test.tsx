// @vitest-environment jsdom
/**
 * Toasts in a project sit at the top on desktop (clear of the prompt dock's
 * controls) and above the bottom nav on phones; a read-only project shows the
 * "open in another tab" notice with Take over.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject, useStore } from '../../state/store';
import { aiSummary } from './AiStatus';
import { Toaster } from './Toaster';

afterEach(() => {
  cleanup();
  useStore.setState({ project: null, toasts: [], readOnly: null });
});

describe('Toaster', () => {
  it('anchors to the top on desktop inside a project, not over the dock', () => {
    useStore.setState({ project: newProject('Home'), toasts: [{ id: 't1', message: 'Photo added.', kind: 'success' }] });
    render(<Toaster />);
    const box = screen.getByTestId('toaster');
    expect(box.className).toContain('lg:top-2');
    expect(box.className).toContain('lg:bottom-auto');
    expect(box.className).not.toContain('lg:bottom-6');
    expect(box.className).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'); // phones: above the bottom nav
    expect(screen.getByText('Photo added.')).toBeTruthy();
  });

  it('stays at the bottom on the projects screen', () => {
    useStore.setState({ project: null, toasts: [{ id: 't1', message: 'Imported', kind: 'success' }] });
    render(<Toaster />);
    expect(screen.getByTestId('toaster').className).not.toContain('lg:top-2');
  });

  it('offers Take over while another tab saves the open project', () => {
    const takeOver = vi.fn(async () => undefined);
    useStore.setState({ project: newProject('Home'), readOnly: 'other-tab', takeOver });
    render(<Toaster />);
    expect(screen.getByText('Open in another tab')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(takeOver).toHaveBeenCalledTimes(1);
  });
});

describe('aiSummary', () => {
  it('without Claude still offers hand-off renders and on-device mapping', () => {
    const off = aiSummary('off', true);
    expect(off).toMatch(/hand-off to your ChatGPT or Gemini app/);
    expect(off).toMatch(/mapped on this device/);
    expect(off).not.toMatch(/unavailable/);
    expect(aiSummary('off', false)).toMatch(/outline areas with the lasso/);
  });

  it('without an image key still renders photoreal variations by hand-off', () => {
    expect(aiSummary('planning-only')).toMatch(/Photoreal variations work by hand-off/);
  });
});
