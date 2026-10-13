/**
 * Project workspace. Desktop (lg+): TopBar + [SpacesSidebar | center |
 * right panel with tab rail]. Phones / small tablets: one pane at a time
 * (store.view.mobilePane) with a bottom nav. Center = StudioView (Studio
 * mode) or EditorView (Fine-tune mode).
 */
import { useEffect } from 'react';
import { EditorView } from '../editor/EditorView';
import { StudioView } from '../studio/StudioView';
import { selectActivePhoto, selectActiveSpace, useStore } from '../../state/store';
import { Spinner } from '../common';
import { AddSpaceModal } from './AddSpaceModal';
import { ErrorBoundary } from './ErrorBoundary';
import { isDesktopViewport, useIsDesktop } from './hooks';
import { MobileNav } from './MobileNav';
import { PhotoPicker } from './PhotoPicker';
import { DesktopRightPanel, MobileRightPanel } from './RightPanel';
import { useShellUI } from './shellUI';
import { SpacesSidebar } from './SpacesSidebar';
import { TopBar } from './TopBar';
import { AddPhotosDropZone, NoSpaceYet } from './WorkspaceEmpty';

export function Workspace() {
  const desktop = useIsDesktop();
  const pane = useStore((s) => s.view.mobilePane);
  const sidebarCollapsed = useShellUI((s) => s.sidebarCollapsed);
  useSelectFirstPhoto();
  useMobilePaneFollowsActions();
  useDocumentTitle();
  useWarnBeforeLeavingDuringRuns();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar />
      {desktop ? (
        <div className="flex min-h-0 flex-1">
          {!sidebarCollapsed && <SpacesSidebar />}
          <main className="relative min-w-0 flex-1" aria-label="Photo">
            <Center />
          </main>
          <DesktopRightPanel />
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            {pane === 'spaces' ? (
              <SpacesSidebar variant="mobile" />
            ) : pane === 'panel' ? (
              <MobileRightPanel />
            ) : (
              <main className="h-full" aria-label="Photo">
                <Center />
              </main>
            )}
          </div>
          <MobileNav />
        </>
      )}
      <PhotoPicker />
      <AddSpaceModal />
    </div>
  );
}

function Center() {
  const mode = useStore((s) => s.mode);
  const space = useStore(selectActiveSpace);
  const photo = useStore(selectActivePhoto);
  const photoId = photo?.id ?? null;

  if (mode === 'finetune') {
    return (
      <ErrorBoundary area="The editor" tone="stage" resetKey={photoId}>
        <EditorView />
      </ErrorBoundary>
    );
  }
  if (!space) return <NoSpaceYet />;
  if (!photo) {
    return space.photos.length ? (
      <div className="flex h-full w-full items-center justify-center bg-stage">
        <Spinner className="size-6 text-white/70" />
      </div>
    ) : (
      <AddPhotosDropZone space={space} />
    );
  }
  return (
    <ErrorBoundary area="The studio" tone="stage" resetKey={photoId}>
      <StudioView />
    </ErrorBoundary>
  );
}

/** A space with photos but none selected (after deleting one, switching spaces): open the first. */
function useSelectFirstPhoto() {
  const firstPhotoId = useStore((s) => {
    const sp = selectActiveSpace(s);
    return sp && !selectActivePhoto(s) ? (sp.photos[0]?.id ?? null) : null;
  });
  useEffect(() => {
    if (firstPhotoId) useStore.getState().select({ photoId: firstPhotoId, regionId: null, objectId: null, lightId: null });
  }, [firstPhotoId]);
}

/**
 * Phones: when something needs the photo (arming a placement, picking a
 * canvas tool, viewing a variation or a compare grid, sketching, starting a
 * run), switch to the photo pane so the user sees the result.
 */
function useMobilePaneFollowsActions() {
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.view.mobilePane === 'editor' || isDesktopViewport() || !s.project) return;
        const newRun = Object.keys(s.runs).some((id) => !(id in prev.runs));
        const wantsPhoto =
          (s.placement && s.placement !== prev.placement) ||
          (s.tool !== prev.tool && s.tool !== 'select') ||
          (s.studio.viewVariationId && s.studio.viewVariationId !== prev.studio.viewVariationId) ||
          (s.studio.gridGenerationId && s.studio.gridGenerationId !== prev.studio.gridGenerationId) ||
          (s.studio.sketch !== 'none' && s.studio.sketch !== prev.studio.sketch) ||
          newRun;
        if (wantsPhoto) s.setView({ mobilePane: 'editor' });
      }),
    [],
  );
}

function useDocumentTitle() {
  const name = useStore((s) => s.project?.name);
  useEffect(() => {
    const prev = document.title;
    document.title = name ? `${name} · Mode` : 'Mode — Home Redesign Studio';
    return () => {
      document.title = prev;
    };
  }, [name]);
}

/** Variations still rendering would be lost on reload: ask first. */
function useWarnBeforeLeavingDuringRuns() {
  const busy = useStore((s) => Object.keys(s.runs).length > 0);
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [busy]);
}
