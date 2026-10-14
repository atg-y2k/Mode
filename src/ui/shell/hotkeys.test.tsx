// @vitest-environment jsdom
/**
 * Undo / redo shortcuts act on the workspace only while no dialog is open:
 * an open dialog makes the app inert, but window keydown listeners still run.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state/store';
import { IS_MAC, useUndoRedoHotkeys } from './useHotkeys';

function Host() {
  useUndoRedoHotkeys();
  return <button type="button">Somewhere</button>;
}

const press = () => {
  const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: !IS_MAC, metaKey: IS_MAC, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

let undo: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  undo = vi.fn<() => void>();
  useStore.setState({ project: { id: 'p' } as never, past: [{}] as never, future: [], undo });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useUndoRedoHotkeys', () => {
  it('undoes the workspace when no dialog is open', () => {
    render(<Host />);
    expect(press().defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('leaves the workspace alone while a dialog is open', () => {
    render(<Host />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(press().defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});
