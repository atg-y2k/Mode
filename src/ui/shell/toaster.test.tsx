// @vitest-environment jsdom
/**
 * Toasts in a project sit just below the top bar on desktop, right-aligned over
 * the right panel (clear of the prompt dock, the mode switch and the photo's
 * own tools) and under an open dialog unless urgent; above the bottom nav on
 * phones; they render outside #root so a dialog's inert app doesn't silence
 * them; a read-only project shows the "open in another tab" notice with Take
 * over. The no-key AI summary stays calm and names what still works.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newProject, useStore } from '../../state/store';
import { AiStatusPill, aiSummary } from './AiStatus';
import { Toaster } from './Toaster';

afterEach(() => {
  cleanup();
  useStore.setState({ project: null, toasts: [], readOnly: null });
});

describe('Toaster', () => {
  it('anchors below the top bar on desktop inside a project, not over the dock or the mode switch', () => {
    useStore.setState({ project: newProject('Home'), toasts: [{ id: 't1', message: 'Photo added.', kind: 'success' }] });
    render(<Toaster />);
    const box = screen.getByTestId('toaster');
    expect(box.className).toContain('lg:top-[4.25rem]'); // the top bar is 3.5rem (h-14)
    expect(box.className).not.toContain('lg:top-2');
    expect(box.className).toContain('lg:bottom-auto');
    expect(box.className).not.toContain('lg:bottom-6');
    expect(box.className).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'); // phones: above the bottom nav
    expect(screen.getByText('Photo added.')).toBeTruthy();
  });

  it('on desktop sits right-aligned over the right panel, not centred over the photo, and under an open dialog', () => {
    useStore.setState({ project: newProject('Home'), toasts: [{ id: 't1', message: 'Next runs start from “A”.', kind: 'info' }] });
    render(<Toaster />);
    const box = screen.getByTestId('toaster');
    // Left of the 5rem tab rail, as wide as the panel's content (20rem; 22rem from xl).
    for (const c of ['lg:left-auto', 'lg:right-[5.5rem]', 'lg:w-[19rem]', 'xl:w-[21rem]', 'lg:items-end', 'lg:px-0']) expect(box.className).toContain(c);
    // An ordinary toast stays under a dialog (z-50) instead of covering its title.
    expect(box.className).toContain('z-40');
    expect(box.className).not.toContain('z-[60]');
  });

  it('errors and the read-only notice stay above an open dialog', () => {
    useStore.setState({ project: newProject('Home'), toasts: [{ id: 't1', message: 'Could not save.', kind: 'error' }] });
    render(<Toaster />);
    expect(screen.getByTestId('toaster').className).toContain('z-[60]');
    cleanup();
    useStore.setState({ project: newProject('Home'), toasts: [], readOnly: 'other-tab' });
    render(<Toaster />);
    expect(screen.getByTestId('toaster').className).toContain('z-[60]');
  });

  it('stays at the bottom on the projects screen', () => {
    useStore.setState({ project: null, toasts: [{ id: 't1', message: 'Imported', kind: 'success' }] });
    render(<Toaster />);
    expect(screen.getByTestId('toaster').className).not.toContain('lg:top-');
    expect(screen.getByTestId('toaster').className).not.toContain('lg:right-');
  });

  it('renders outside the app root, so toasts stay live while a dialog makes the app inert', () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    document.body.appendChild(appRoot);
    useStore.setState({ project: newProject('Home'), toasts: [{ id: 't1', message: 'Prompt copied.', kind: 'info' }] });
    render(<Toaster />, { container: appRoot });
    const box = screen.getByTestId('toaster');
    expect(appRoot.contains(box)).toBe(false);
    expect(box.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    appRoot.remove();
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
  it('without a key says what works, calmly, and that a Claude key is optional', () => {
    const off = aiSummary('off', true);
    expect(off).toMatch(/^No AI key: Mode writes each instruction from your choices/);
    expect(off).toMatch(/from your ChatGPT or Gemini app by hand-off/);
    expect(off).toMatch(/scenes map on this device/);
    expect(off).toMatch(/A Claude key \(optional\) adds tailored plans and suggestions\.$/);
    expect(off).not.toMatch(/unavailable|Claude is off|need a key/);
    expect(aiSummary('off', false)).toMatch(/you outline areas with the lasso/);
  });

  it('the header pill reads "No AI key · hand-off" (no talk of Claude being off)', () => {
    useStore.setState({ health: { ok: true, ai: { enabled: false, model: null }, imageProvider: { enabled: false, name: null, model: null } } });
    render(<AiStatusPill />);
    const pill = screen.getByRole('button', { name: 'No AI key · hand-off' });
    expect(pill.title).toMatch(/^No AI key:/);
    expect(document.body.textContent).not.toMatch(/Claude\s+(is\s+)?off/);
    useStore.setState({ health: null });
  });

  it('without an image key still renders photoreal variations by hand-off', () => {
    expect(aiSummary('planning-only')).toMatch(/Photoreal variations work by hand-off/);
  });
});
