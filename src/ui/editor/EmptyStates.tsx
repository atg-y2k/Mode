/**
 * Editor states before there is a photo to edit: no space yet, a space
 * without photos (drop zone / camera), photo loading and photo errors.
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Armchair,
  Bath,
  Bed,
  Camera,
  CookingPot,
  Flower2,
  House,
  ImagePlus,
  RefreshCw,
  Sofa,
  Trees,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { SPACE_TYPE_LABELS, type Space, type SpaceType } from '../../../shared/types';
import { useStore } from '../../state/store';
import { Button, Spinner, cn } from '../common';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
}

export function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Adds image files to a space with friendly feedback. Returns how many were added. */
export async function importPhotos(spaceId: string, files: File[]): Promise<number> {
  const s = useStore.getState();
  const images = files.filter(isImageFile);
  if (!images.length) {
    s.notify('Those files aren’t photos — choose JPEG, PNG, WebP or HEIC images.', 'error');
    return 0;
  }
  const skipped = files.length - images.length;
  if (skipped) s.notify(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'isn’t an image' : 'aren’t images'}.`, 'info');
  const ids = await s.addPhotos(spaceId, images);
  if (ids.length) {
    s.notify(
      ids.length === 1 ? 'Photo added — add a surface to start redesigning.' : `${ids.length} photos added.`,
      'success',
    );
  }
  return ids.length;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const on = () => setCoarse(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return coarse;
}

// ---------------------------------------------------------------------------
// No space
// ---------------------------------------------------------------------------

const QUICK_SPACES: { kind: 'Inside' | 'Outside'; items: { type: SpaceType; icon: LucideIcon }[] }[] = [
  {
    kind: 'Inside',
    items: [
      { type: 'living-room', icon: Sofa },
      { type: 'kitchen', icon: CookingPot },
      { type: 'bedroom', icon: Bed },
      { type: 'bathroom', icon: Bath },
    ],
  },
  {
    kind: 'Outside',
    items: [
      { type: 'front-exterior', icon: House },
      { type: 'front-yard', icon: Flower2 },
      { type: 'backyard', icon: Trees },
      { type: 'patio', icon: Armchair },
    ],
  },
];

export function NoSpaceState() {
  const spaces = useStore((s) => s.project?.spaces);
  const list = spaces ?? [];

  if (list.length) {
    return (
      <Shell>
        <Hero icon={<House className="size-6" />} title="Pick a space to work on">
          Choose a room or outdoor area. Each space keeps its own photos and design options.
        </Hero>
        <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((sp) => (
            <button
              key={sp.id}
              type="button"
              onClick={() => useStore.getState().selectSpace(sp.id)}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-text">{sp.name}</span>
                <span className="block text-xs text-muted">{SPACE_TYPE_LABELS[sp.type]}</span>
              </span>
              <span className="shrink-0 text-xs text-subtle">
                {sp.photos.length} photo{sp.photos.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Hero icon={<House className="size-6" />} title="Start with a space">
        A space is a room or an outdoor area — the living room, the front of the house, the backyard. Add one, then upload photos
        of it to try paint, materials, lighting and plants.
      </Hero>
      <div className="flex w-full max-w-lg flex-col gap-4">
        {QUICK_SPACES.map((group) => (
          <div key={group.kind} className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">{group.kind}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {group.items.map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => useStore.getState().addSpace(type)}
                  className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-3 text-sm text-text transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Icon className="size-5 text-accent" aria-hidden />
                  <span className="text-center leading-tight">{SPACE_TYPE_LABELS[type]}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-center text-xs text-muted">
          More types (office, deck, driveway, pool area…) are in{' '}
          <button
            type="button"
            className="font-medium text-accent underline-offset-2 hover:underline"
            onClick={() => useStore.getState().setView({ mobilePane: 'spaces' })}
          >
            Spaces
          </button>
          .
        </p>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Space without photos
// ---------------------------------------------------------------------------

const TIPS: Record<Space['kind'], string[]> = {
  interior: [
    'Stand in a corner to capture two walls and the floor.',
    'Use daylight or turn on the lights — avoid dark, grainy shots.',
    'Hold the phone level; wide-angle is fine.',
  ],
  exterior: [
    'Step back far enough to include the whole facade or yard.',
    'Overcast days give even light with soft shadows.',
    'Shoot from where you’d normally view it — the street or the patio.',
  ],
};

export function PhotoDropZone({ space }: { space: Space }) {
  const [importing, setImporting] = useState(0);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const coarse = useCoarsePointer();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handle = async (files: File[]) => {
    if (!files.length || importing) return;
    setImporting(files.length);
    try {
      await importPhotos(space.id, files);
    } finally {
      if (mounted.current) setImporting(0);
    }
  };

  return (
    <Shell>
      <div
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
          void handle(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'flex w-full max-w-xl flex-col items-center gap-4 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:px-10',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface',
        )}
      >
        {importing ? (
          <>
            <Spinner className="size-8 text-accent" />
            <p className="font-medium text-text">
              Importing {importing} photo{importing === 1 ? '' : 's'}…
            </p>
            <p className="text-sm text-muted">Large photos are resized for smooth editing.</p>
          </>
        ) : (
          <>
            <div className="rounded-2xl bg-accent-soft p-3 text-accent">
              {over ? <Upload className="size-7" aria-hidden /> : <ImagePlus className="size-7" aria-hidden />}
            </div>
            <div>
              <h2 className="font-display text-2xl text-text">Add photos of {space.name}</h2>
              <p className="mt-1 text-sm text-muted">
                {over ? 'Drop to upload.' : coarse ? 'Take a photo or choose some from your library.' : 'Drag photos here, or choose files.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {coarse && (
                <Button variant="primary" size="lg" icon={<Camera className="size-5" />} onClick={() => cameraRef.current?.click()}>
                  Take a photo
                </Button>
              )}
              <Button
                variant={coarse ? 'secondary' : 'primary'}
                size="lg"
                icon={<ImagePlus className="size-5" />}
                onClick={() => fileRef.current?.click()}
              >
                Choose photos
              </Button>
            </div>
            <ul className="mt-2 flex max-w-sm flex-col gap-1.5 text-left text-xs text-muted">
              {TIPS[space.kind].map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-gold" />
                  {t}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void handle(files);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void handle(files);
        }}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Loading / error
// ---------------------------------------------------------------------------

export function PhotoLoading({ name }: { name: string }) {
  return (
    <div role="status" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-stage text-white/75">
      <Spinner className="size-7 text-white/80" />
      <p className="max-w-xs truncate px-6 text-sm">Opening {name}…</p>
    </div>
  );
}

export function PhotoError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-stage px-6 text-center text-white">
      <AlertTriangle className="size-8 text-warning" aria-hidden />
      <p className="font-medium">This photo couldn’t be opened</p>
      <p className="max-w-sm text-sm text-white/70">{message}</p>
      <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
        Try again
      </Button>
      <p className="max-w-sm text-xs text-white/55">If it keeps failing, delete the photo from the Spaces list and upload it again.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-thin flex h-full w-full flex-col items-center overflow-y-auto bg-bg px-4 py-8 sm:py-12">
      <div className="my-auto flex w-full flex-col items-center gap-6">{children}</div>
    </div>
  );
}

function Hero({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-2 text-center">
      <div className="mb-1 rounded-2xl bg-accent-soft p-3 text-accent">{icon}</div>
      <h2 className="font-display text-2xl text-text sm:text-3xl">{title}</h2>
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}
