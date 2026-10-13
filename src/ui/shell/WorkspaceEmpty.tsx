/**
 * Studio-mode center before there is a photo to work on: start a space (quick
 * tiles), or add photos to the selected space (drop zone + picker). The
 * Fine-tune editor has its own equivalents.
 */
import { useState } from 'react';
import { Camera, ImagePlus, Plus, ScanSearch, Sun } from 'lucide-react';
import { SPACE_TYPE_LABELS, type Space, type SpaceType } from '../../../shared/types';
import { useStore } from '../../state/store';
import { Button, cn } from '../common';
import { aiLevel } from './AiStatus';
import { dragHasFiles, importPhotosToSpace, pickPhotos } from './photoImport';
import { openAddSpace } from './shellUI';
import { SPACE_ICONS } from './spaceMeta';

const QUICK: { title: string; types: SpaceType[] }[] = [
  { title: 'Outside', types: ['front-exterior', 'front-yard', 'backyard', 'patio'] },
  { title: 'Inside', types: ['living-room', 'kitchen', 'bedroom', 'bathroom'] },
];

export function NoSpaceYet() {
  const spaces = useStore((s) => s.project?.spaces);
  const list = spaces ?? [];
  return (
    <div className="scroll-thin flex h-full w-full flex-col items-center overflow-y-auto bg-bg px-4 py-10 sm:justify-center">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Plus className="size-6" aria-hidden />
          </span>
          <h2 className="font-display text-2xl text-text sm:text-3xl">{list.length ? 'Pick a space' : 'What would you like to redesign?'}</h2>
          <p className="max-w-md text-sm text-muted">
            {list.length
              ? 'Choose a room or outdoor area in the Spaces list, or add another one.'
              : 'Start with one space — a room or an outdoor area. You can add more any time.'}
          </p>
        </div>
        <div className="flex w-full flex-col gap-4 text-left">
          {QUICK.map((g) => (
            <div key={g.title} className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">{g.title}</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {g.types.map((t) => {
                  const Icon = SPACE_ICONS[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => useStore.getState().addSpace(t)}
                      className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-3 text-sm text-text shadow-panel transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <Icon className="size-5 text-accent" aria-hidden />
                      <span className="text-center leading-tight">{SPACE_TYPE_LABELS[t]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => openAddSpace()}>
          More space types — office, deck, driveway, pool area…
        </Button>
      </div>
    </div>
  );
}

export function AddPhotosDropZone({ space }: { space: Space }) {
  const [over, setOver] = useState(false);
  const level = useStore((s) => aiLevel(s.health));
  const outdoors = space.kind === 'exterior';
  return (
    <div
      className="scroll-thin flex h-full w-full flex-col items-center overflow-y-auto bg-bg p-4 sm:justify-center sm:p-8"
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        void importPhotosToSpace(space.id, Array.from(e.dataTransfer.files));
      }}
    >
      <div
        className={cn(
          'flex w-full max-w-2xl flex-col items-center gap-5 rounded-3xl border-2 border-dashed px-5 py-10 text-center transition-colors sm:px-10 sm:py-14',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface',
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <ImagePlus className="size-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-2xl text-text sm:text-3xl">Add photos of {space.name}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">
            {over
              ? 'Drop to add them.'
              : level === 'ready' || level === 'planning-only'
                ? `Drop images here or choose them. Mode maps each photo automatically — ${outdoors ? 'facade, door, walkway, lawn, beds and paths' : 'walls, floor, ceiling, cabinetry and furniture'} — so you can start designing right away.`
                : 'Drop images here or choose them. JPEG, PNG, WebP and HEIC (Safari) work; large photos are scaled down on this device.'}
          </p>
        </div>
        <Button variant="primary" size="lg" icon={<Camera className="size-5" />} onClick={() => pickPhotos(space.id)}>
          Choose photos
        </Button>
        <ul className="grid w-full max-w-lg gap-2 text-left text-xs text-muted sm:grid-cols-2">
          <li className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
            <Sun className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            {outdoors ? 'Shoot in soft daylight; avoid harsh noon shadows across the facade.' : 'Turn on the lights and open the blinds for even light.'}
          </li>
          <li className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
            <ScanSearch className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            {outdoors ? 'Stand back far enough to include the whole area you want to change.' : 'Shoot from a corner at chest height to capture walls and floor.'}
          </li>
        </ul>
      </div>
    </div>
  );
}
