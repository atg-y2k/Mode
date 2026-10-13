/**
 * The canvas editor for the active photo + design option: design tabs and
 * compare controls on top, the tool palette (vertical rail on desktop, bottom
 * strip on phones) and the stage. Shows guided empty states until there is a
 * photo to edit.
 */
import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Photo, Space } from '../../../shared/types';
import * as runtime from '../../state/runtime';
import { selectActivePhoto, selectActiveSpace, useStore } from '../../state/store';
import { Spinner } from '../common';
import { CompareControls, HoldOriginalButton } from './CompareControls';
import { DesignTabs } from './DesignTabs';
import { NoSpaceState, PhotoDropZone, PhotoError, PhotoLoading, dragHasFiles, importPhotos } from './EmptyStates';
import { Stage } from './Stage';
import { ToolPalette } from './ToolPalette';

export function EditorView() {
  const hasProject = useStore((s) => !!s.project);
  const space = useStore(selectActiveSpace);
  const photo = useStore(selectActivePhoto);
  const firstPhotoId = space && !photo ? space.photos[0]?.id : undefined;

  // A space with photos but none selected (e.g. after deleting one): open the first.
  useEffect(() => {
    if (firstPhotoId) useStore.getState().select({ photoId: firstPhotoId, regionId: null, objectId: null, lightId: null });
  }, [firstPhotoId]);

  if (!hasProject) return <div className="h-full w-full bg-stage" />;
  if (!space) return <NoSpaceState />;
  if (!photo) {
    return firstPhotoId ? (
      <div className="flex h-full w-full items-center justify-center bg-stage">
        <Spinner className="size-6 text-white/70" />
      </div>
    ) : (
      <PhotoDropZone space={space} />
    );
  }
  return <PhotoEditor photo={photo} space={space} />;
}

type LoadState = { id: string; kind: 'loading' } | { id: string; kind: 'ready' } | { id: string; kind: 'error'; message: string };

function isLoaded(photo: Photo): boolean {
  return !!runtime.getPhotoImage(photo.id) && photo.regions.every((r) => !!runtime.getMask(r.maskId));
}

/** Decodes the photo and loads its masks before the stage mounts (synchronous when cached). */
function usePhotoLoad(photo: Photo): { state: LoadState; retry: () => void } {
  const projectId = useStore((s) => s.project?.id);
  const [state, setState] = useState<LoadState>(() => ({ id: photo.id, kind: isLoaded(photo) ? 'ready' : 'loading' }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (isLoaded(photo)) {
      setState({ id: photo.id, kind: 'ready' });
      return;
    }
    setState({ id: photo.id, kind: 'loading' });
    runtime.preloadPhoto(photo).then(
      () => {
        if (!cancelled) setState({ id: photo.id, kind: 'ready' });
      },
      (err: unknown) => {
        if (!cancelled) setState({ id: photo.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
    // Re-run only when a different photo (or project) is opened, or on retry.
  }, [photo.id, projectId, attempt]);

  const current: LoadState = state.id === photo.id ? state : { id: photo.id, kind: isLoaded(photo) ? 'ready' : 'loading' };
  return { state: current, retry: () => setAttempt((a) => a + 1) };
}

function PhotoEditor({ photo, space }: { photo: Photo; space: Space }) {
  const { state, retry } = usePhotoLoad(photo);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div data-editor-root className="flex h-full min-h-0 w-full flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 lg:px-3">
        <DesignTabs photo={photo} />
        <div className="flex shrink-0 items-center gap-1.5">
          <CompareControls />
          <HoldOriginalButton />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ToolPalette className="order-2 lg:order-1" />
        <div
          className="relative order-1 min-h-0 min-w-0 flex-1 lg:order-2"
          onDragOver={(e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            setDragOver(false);
            void importPhotos(space.id, Array.from(e.dataTransfer.files));
          }}
        >
          {state.kind === 'ready' ? (
            <Stage key={photo.id} photo={photo} />
          ) : state.kind === 'error' ? (
            <PhotoError message={state.message} onRetry={retry} />
          ) : (
            <PhotoLoading name={photo.name} />
          )}
          {dragOver && (
            <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/80 bg-black/55 text-white backdrop-blur-sm">
              <ImagePlus className="size-8" aria-hidden />
              <p className="font-medium">Drop to add photos to {space.name}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
