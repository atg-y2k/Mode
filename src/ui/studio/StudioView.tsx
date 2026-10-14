/**
 * Studio center pane (SPEC §3.14, §5.2): the viewer — or the side-by-side
 * grid of a run, or the staging view of a returned hand-off — above the
 * variations strip and the prompt dock. Also hosts the hand-off companion
 * (inline card / Picture-in-Picture) and the ways a returned image comes
 * back (paste, drop, clipboard offer, Downloads watcher). The review step
 * before every run is hosted by the Workspace (it must exist on every pane).
 *
 * Keyboard: ←/→ step through the variations of the current run, F favorite,
 * Esc back to the original (closes the grid first), [ or ] toggle the areas
 * overlay (over a shown result: on that result only — results are shown clean). Shortcuts are ignored while typing or when a dialog is open.
 */
import { ImageOff } from 'lucide-react';
import { useEffect } from 'react';
import { findVariation, selectActivePhoto, useStore } from '../../state/store';
import { ConfirmModal } from '../common';
import { deleteRun, stepVariation, viewVariation } from './actions';
import { CompareGrid } from './CompareGrid';
import { recoverInterruptedRuns } from './generate';
import { CompanionDock } from './handoff/Companion';
import { ClipboardOfferBanner, HandoffImportEffects, useHandoffDrop } from './handoff/ImportLayer';
import { installHandoffPrefs } from './handoff/prefs';
import { syncHandoffProject, useHandoffSession } from './handoff/session';
import { StagingView } from './handoff/StagingView';
import { useActivePhoto } from './hooks';
import { PromptDock } from './PromptDock';
import { installBaseReset, setStudioUI, toggleAreasOverlay, useStudioUI } from './ui';
import { VariationStrip } from './VariationStrip';
import { Viewer } from './Viewer';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function useStudioShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || isTyping(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const s = useStore.getState();
      if (s.mode !== 'studio') return;
      const photo = selectActivePhoto(s);
      if (!photo) return;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          stepVariation(photo, e.key === 'ArrowLeft' ? -1 : 1);
          break;
        case 'f':
        case 'F': {
          const v = findVariation(photo, s.studio.viewVariationId);
          if (!v) return;
          s.toggleFavorite(photo.id, v.id);
          break;
        }
        case 'Escape':
          if (s.studio.gridGenerationId) s.setStudio({ gridGenerationId: null });
          else if (s.studio.viewVariationId) {
            viewVariation(null);
            setStudioUI({ slider: false });
          } else return;
          break;
        case '[':
        case ']':
          toggleAreasOverlay(!!findVariation(photo, s.studio.viewVariationId));
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ConfirmDelete() {
  const confirm = useStudioUI((s) => s.confirm);
  const close = () => setStudioUI({ confirm: null });
  return (
    <ConfirmModal
      open={!!confirm}
      onClose={close}
      title={confirm?.kind === 'run' ? 'Delete this run?' : 'Delete this variation?'}
      message={
        confirm?.kind === 'run'
          ? `“${confirm.title}” and all of its variations will be removed. This can't be undone.`
          : `“${confirm?.title ?? ''}” will be removed. This can't be undone.`
      }
      onConfirm={() => {
        if (!confirm) return;
        if (confirm.kind === 'run') void deleteRun(confirm.photoId, confirm.id);
        else void useStore.getState().deleteVariation(confirm.photoId, confirm.id);
      }}
    />
  );
}

export function StudioView() {
  const { photo, space } = useActivePhoto();
  const projectId = useStore((s) => s.project?.id);
  const gridId = useStore((s) => s.studio.gridGenerationId);
  const staging = useHandoffSession((s) => s.staging);
  const drop = useHandoffDrop();
  useStudioShortcuts();

  useEffect(() => {
    installHandoffPrefs();
    installBaseReset();
  }, []);

  // Hand-off items belong to one project: switching projects closes the companion and staging.
  useEffect(() => syncHandoffProject(projectId ?? null), [projectId]);

  // Runs a previous session left 'running' were interrupted by the reload.
  useEffect(() => {
    if (projectId) recoverInterruptedRuns();
  }, [projectId]);

  // Viewer-local state belongs to one photo.
  useEffect(() => {
    setStudioUI({ slider: false, editingPathId: null });
  }, [photo?.id]);

  if (!photo) {
    return (
      <div className="grid h-full w-full place-items-center bg-stage p-6 text-center text-sm text-white/60">
        <div className="flex flex-col items-center gap-2">
          <ImageOff className="size-6" />
          Choose a photo to start designing.
        </div>
      </div>
    );
  }

  const grid = gridId ? photo.generations.find((g) => g.id === gridId) : undefined;
  const stagingHere = staging && staging.photoId === photo.id ? staging : null;
  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="relative min-h-0 flex-1" {...drop.handlers}>
        {stagingHere ? (
          <StagingView key={stagingHere.plannedId} photo={photo} stagingRef={stagingHere} />
        ) : grid ? (
          <CompareGrid photo={photo} space={space} generation={grid} />
        ) : (
          <Viewer photo={photo} space={space} />
        )}
        <CompanionDock />
        <ClipboardOfferBanner />
        {drop.overlay}
      </div>
      <VariationStrip photo={photo} />
      <PromptDock photo={photo} space={space} />
      <ConfirmDelete />
      <HandoffImportEffects />
    </div>
  );
}
