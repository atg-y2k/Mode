/** React hooks shared by the hand-off UI. */
import { useStore } from '../../../state/store';
import { projectPendingHandoffs, type PendingItem } from './planned';

/** Pending hand-offs of the project (active photo first), re-rendering on change. */
export function usePendingHandoffs(): PendingItem[] {
  const project = useStore((s) => s.project);
  const photoId = useStore((s) => s.selection.photoId);
  return projectPendingHandoffs(project, photoId);
}
