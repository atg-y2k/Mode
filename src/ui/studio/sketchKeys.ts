/**
 * Keys of the Viewer's sketch tools (lasso / path sketch, "Tap to select",
 * path editing), handled in the capture phase before the Studio's own
 * shortcuts: Enter finishes / keeps, Esc cancels / clears, Backspace / Delete
 * takes back the last point or tap. Typing in a field and an open dialog
 * (Settings, the Review…) keep their keys — Esc on a dialog's button closes
 * the dialog instead of cancelling the sketch behind it.
 */

export interface SketchKeyState {
  sketch: 'none' | 'path' | 'area';
  /** The path whose handles are being edited, if any. */
  editing: string | null;
  tapActive: boolean;
  /** "Tap to select" has picked something. */
  hasTapSelection: boolean;
}

export interface SketchKeyActions {
  finishSketch(): void;
  cancelSketch(): void;
  undoPoint(): void;
  stopEditingPath(): void;
  keepTapSelection(): void;
  clearTapSelection(): void;
  stopTapSelect(): void;
  undoTap(): void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''));
}

/** Runs the sketch action for `e` and claims the key (preventDefault + stopPropagation); false when the key is left alone. */
export function handleSketchKey(e: KeyboardEvent, k: SketchKeyState, a: SketchKeyActions): boolean {
  if (k.sketch === 'none' && !k.editing && !k.tapActive) return false;
  if (isTypingTarget(e.target)) return false;
  // An open dialog owns Enter / Esc / Backspace, even on its buttons.
  if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return false;
  const undo = e.key === 'Backspace' || e.key === 'Delete';
  if (k.tapActive) {
    if (e.key === 'Enter' && k.hasTapSelection) a.keepTapSelection();
    else if (e.key === 'Escape') {
      if (k.hasTapSelection) a.clearTapSelection();
      else a.stopTapSelect();
    } else if (undo && k.hasTapSelection) a.undoTap();
    else return false;
  } else if (k.sketch !== 'none') {
    if (e.key === 'Enter') a.finishSketch();
    else if (e.key === 'Escape') a.cancelSketch();
    else if (undo) a.undoPoint();
    else return false;
  } else if (e.key === 'Enter' || e.key === 'Escape') a.stopEditingPath();
  else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}
