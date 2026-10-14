// @vitest-environment jsdom
/**
 * The Viewer's capture-phase sketch keys (lasso / path sketch, Tap to select,
 * path editing) leave an open dialog alone: Esc on a button in Settings or the
 * Review closes the dialog instead of cancelling the sketch behind it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { handleSketchKey, type SketchKeyActions, type SketchKeyState } from './sketchKeys';

/** A lasso with three points, wired like the Viewer: a window capture listener. */
function lasso(state: Partial<SketchKeyState> = {}) {
  let points = [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 5 },
  ];
  const calls: string[] = [];
  const actions: SketchKeyActions = {
    finishSketch: () => calls.push('finish'),
    cancelSketch: () => {
      calls.push('cancel');
      points = [];
    },
    undoPoint: () => {
      calls.push('undo');
      points = points.slice(0, -1);
    },
    stopEditingPath: () => calls.push('stop-editing'),
    keepTapSelection: () => calls.push('keep'),
    clearTapSelection: () => calls.push('clear'),
    stopTapSelect: () => calls.push('stop-tap'),
    undoTap: () => calls.push('undo-tap'),
  };
  const k: SketchKeyState = { sketch: 'area', editing: null, tapActive: false, hasTapSelection: false, ...state };
  const onKey = (e: KeyboardEvent) => void handleSketchKey(e, k, actions);
  window.addEventListener('keydown', onKey, true);
  const press = (target: Element, key: string) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  return { press, calls, points: () => points, dispose: () => window.removeEventListener('keydown', onKey, true) };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  document.body.innerHTML = '';
});

function dialogWithButton(): HTMLButtonElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const button = document.createElement('button');
  button.textContent = 'Cancel';
  dialog.appendChild(button);
  document.body.appendChild(dialog);
  button.focus();
  return button;
}

describe('sketch keys', () => {
  it('Esc / Enter / Backspace on a dialog button leave the sketch alone and are not claimed', () => {
    const s = lasso();
    disposers.push(s.dispose);
    const button = dialogWithButton();
    for (const key of ['Escape', 'Enter', 'Backspace']) {
      const e = s.press(button, key);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(s.calls).toEqual([]);
    expect(s.points()).toHaveLength(3);
  });

  it('without a dialog they drive the sketch and are claimed', () => {
    const s = lasso();
    disposers.push(s.dispose);
    const undo = s.press(document.body, 'Backspace');
    expect(undo.defaultPrevented).toBe(true);
    expect(s.points()).toHaveLength(2);
    const esc = s.press(document.body, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(s.calls).toEqual(['undo', 'cancel']);
    expect(s.points()).toHaveLength(0);
  });

  it('typing in a field and other keys are left alone; nothing happens without a sketch tool', () => {
    const s = lasso();
    disposers.push(s.dispose);
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(s.press(input, 'Backspace').defaultPrevented).toBe(false);
    expect(s.press(document.body, 'a').defaultPrevented).toBe(false);
    expect(s.points()).toHaveLength(3);
    const idle = lasso({ sketch: 'none' });
    disposers.push(idle.dispose);
    expect(handleSketchKey(new KeyboardEvent('keydown', { key: 'Escape' }), { sketch: 'none', editing: null, tapActive: false, hasTapSelection: false }, {} as SketchKeyActions)).toBe(false);
  });

  it('Tap to select: Esc clears a selection, then stops; also ignored under a dialog', () => {
    const s = lasso({ sketch: 'none', tapActive: true, hasTapSelection: true });
    disposers.push(s.dispose);
    const button = dialogWithButton();
    expect(s.press(button, 'Escape').defaultPrevented).toBe(false);
    expect(s.calls).toEqual([]);
    document.body.innerHTML = '';
    expect(s.press(document.body, 'Escape').defaultPrevented).toBe(true);
    expect(s.calls).toEqual(['clear']);
  });
});
