/**
 * Global keyboard shortcuts owned by the shell: undo (Ctrl/Cmd+Z) and redo
 * (Shift+Ctrl/Cmd+Z, Ctrl+Y). Ignored while typing in a text field (those
 * keep their native text undo) and when another handler already took the key.
 */
import { useEffect } from 'react';
import { useStore } from '../../state/store';
import { isEditableTarget, isMacPlatform, matchUndoRedo } from './format';

export const IS_MAC = isMacPlatform();

export function useUndoRedoHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = matchUndoRedo(e, IS_MAC);
      if (!action) return;
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const s = useStore.getState();
      if (!s.project) return;
      e.preventDefault();
      if (action === 'undo') {
        if (s.past.length) s.undo();
      } else if (s.future.length) {
        s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
