// @vitest-environment jsdom
/**
 * Shared primitives' accessibility contracts: a Modal is named by its title
 * and keeps the app (#root) inert while open (nested modals included);
 * Segmented is a radio group with one Tab stop and arrow keys that move and
 * select.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal, Segmented, radioKeyIndex } from './index';

let appRoot: HTMLElement;
beforeEach(() => {
  appRoot = document.createElement('div');
  appRoot.id = 'root';
  document.body.appendChild(appRoot);
});
afterEach(() => {
  cleanup();
  appRoot.remove();
});

function ModalHarness({ nested = false }: { nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Settings">
        <input aria-label="Project name" />
        {nested && (
          <>
            <button type="button" onClick={() => setInner(true)}>
              Delete project
            </button>
            <Modal open={inner} onClose={() => setInner(false)} title="Delete this project?">
              <p>Gone for good.</p>
            </Modal>
          </>
        )}
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is named by its title and makes the app inert while open', () => {
    render(<ModalHarness />, { container: appRoot });
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Settings');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(dialog);
    // The dialog portals out of the inert app, so it stays usable.
    expect(appRoot.hasAttribute('inert')).toBe(true);
    expect(appRoot.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText('Project name'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the app inert until the last of nested dialogs closes', () => {
    render(<ModalHarness nested />, { container: appRoot });
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(screen.getByRole('dialog', { name: 'Delete this project?' })).toBeTruthy();
    expect(appRoot.hasAttribute('inert')).toBe(true);
    // Close only the inner one (its own Close button).
    const inner = screen.getByRole('dialog', { name: 'Delete this project?' });
    fireEvent.click(inner.querySelector<HTMLElement>('button[aria-label="Close"]')!);
    expect(screen.queryByRole('dialog', { name: 'Delete this project?' })).toBeNull();
    expect(appRoot.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(appRoot.hasAttribute('inert')).toBe(false);
  });

  it('focuses the dialog itself when it has no field to start in', () => {
    render(
      <Modal open onClose={() => undefined} title="About">
        <p>Plain text only.</p>
      </Modal>,
      { container: appRoot },
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'About' }));
  });
});

function SegmentedHarness({ initial = 'b', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button">Before</button>
      <Segmented
        label="Quality"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        options={[
          { value: 'a', label: 'Draft' },
          { value: 'b', label: 'Standard' },
          { value: 'c', label: 'High' },
        ]}
      />
      <button type="button">After</button>
    </>
  );
}

const tabStops = () => screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);

describe('Segmented', () => {
  it('is one Tab stop: only the checked option is in the tab order', () => {
    render(<SegmentedHarness />);
    expect(screen.getByRole('radiogroup', { name: 'Quality' })).toBeTruthy();
    expect(tabStops().map((r) => r.textContent)).toEqual(['Standard']);
    expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === -1)).toHaveLength(2);
  });

  it('keeps the first option reachable when the value matches none', () => {
    render(<SegmentedHarness initial="zzz" />);
    expect(tabStops().map((r) => r.textContent)).toEqual(['Draft']);
  });

  it('arrow keys select the next / previous option (wrapping) and move focus with it', () => {
    const onChange = vi.fn();
    render(<SegmentedHarness onChange={onChange} />);
    const standard = screen.getByRole('radio', { name: 'Standard' });
    standard.focus();
    fireEvent.keyDown(standard, { key: 'ArrowRight' });
    const high = screen.getByRole('radio', { name: 'High' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(high.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(high);
    expect(tabStops()).toEqual([high]);

    fireEvent.keyDown(high, { key: 'ArrowDown' }); // wraps to the first
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Draft' }));
    expect(onChange).toHaveBeenLastCalledWith('a');

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // wraps to the last
    expect(document.activeElement).toBe(high);
    fireEvent.keyDown(high, { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'Draft' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(high.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(high);
  });

  it('keeps its arrow keys from page-level shortcuts', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<SegmentedHarness />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Standard' }), { key: 'ArrowRight' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('maps keys to options', () => {
    expect(radioKeyIndex('ArrowRight', 2, 3)).toBe(0);
    expect(radioKeyIndex('ArrowUp', 0, 3)).toBe(2);
    expect(radioKeyIndex('End', 0, 3)).toBe(2);
    expect(radioKeyIndex('Enter', 0, 3)).toBeNull();
    expect(radioKeyIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
