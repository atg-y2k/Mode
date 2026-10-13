/**
 * Every way a returned image comes back while a hand-off is pending:
 * - page-wide paste (⌘V / Ctrl+V anywhere in Mode);
 * - drag & drop onto the Studio (files, file items, or an image dragged
 *   from the ChatGPT / Gemini tab — fetched through the server);
 * - "Import copied image?" when `clipboardchange` (Chromium 144+) reports an
 *   image on the clipboard as the user comes back;
 * - the optional Downloads-folder watcher (local server, src/lib/handoff).
 */
import { ClipboardPaste, ImageDown, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { fetchDownloadedFile, handoffWatchStatus, watchDownloads } from '../../../lib/handoff';
import { useStore } from '../../../state/store';
import { importBlobs } from './actions';
import { readClipboardImage } from './clipboard';
import { usePendingHandoffs } from './Companion';
import { useToggle, WATCH_DOWNLOADS_KEY } from './prefs';
import { handoffSession, setHandoffSession, useHandoffSession } from './session';
import { clipboardChangeSupported, dragLooksImportable, transferImages } from './sources';

function notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  useStore.getState().notify(message, kind);
}

function hasImageData(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if ((dt.files?.length ?? 0) > 0) return true;
  return Array.from(dt.items ?? []).some((i) => i.kind === 'file' && (i.type.startsWith('image/') || i.type === ''));
}

/**
 * Whether a page-wide paste belongs to the hand-off: yes while the
 * companion or staging is up; when the card is collapsed the Idea board
 * (which also takes pasted images) keeps its own paste.
 */
function pasteIsForHandoff(): boolean {
  const s = handoffSession();
  if (s.companion === 'open' || s.staging || s.pip) return true;
  return useStore.getState().studio.panel !== 'ideas';
}

/** Mount once in the Studio: page-wide paste, clipboardchange offer and the Downloads watcher. */
export function HandoffImportEffects() {
  const pending = usePendingHandoffs();
  const anyPending = pending.length > 0;
  const anyWaiting = pending.some((p) => p.planned.status === 'awaiting-handoff');
  const watchOn = useToggle(WATCH_DOWNLOADS_KEY);

  // Paste anywhere (capture phase: runs before the Idea board's own window listener).
  useEffect(() => {
    if (!anyPending) return;
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      // Text pastes (also into text fields) are left alone; image data is ours — even with the prompt focused.
      if (!hasImageData(dt) || document.querySelector('[aria-modal="true"]')) return;
      if (!pasteIsForHandoff()) return;
      e.preventDefault();
      e.stopPropagation();
      setHandoffSession({ clipboardOffer: false });
      void transferImages(dt)
        .then((blobs) => importBlobs(blobs))
        .catch((err: Error) => notify(err.message, 'error'));
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, [anyPending]);

  // "Import copied image?" — clipboardchange lists the types without reading the clipboard.
  useEffect(() => {
    if (!anyWaiting || !clipboardChangeSupported()) return;
    const clip = navigator.clipboard as Clipboard & EventTarget;
    const onChange = (e: Event) => {
      const types = (e as Event & { types?: string[] }).types ?? [];
      if (types.some((t) => t.startsWith('image/'))) setHandoffSession({ clipboardOffer: true });
    };
    clip.addEventListener('clipboardchange', onChange);
    return () => clip.removeEventListener('clipboardchange', onChange);
  }, [anyWaiting]);

  useEffect(() => {
    if (!anyWaiting) setHandoffSession({ clipboardOffer: false });
  }, [anyWaiting]);

  // Downloads watcher: availability once, then watch only while something waits and the toggle is on.
  useEffect(() => {
    if (handoffSession().watch.available !== null) return;
    let alive = true;
    Promise.resolve()
      .then(() => handoffWatchStatus())
      .then((st) => alive && setHandoffSession({ watch: { ...handoffSession().watch, available: st.available, dir: st.dir } }))
      .catch(() => alive && setHandoffSession({ watch: { ...handoffSession().watch, available: false } }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!watchOn || !anyWaiting) {
      setHandoffSession({ watch: { ...handoffSession().watch, on: false } });
      return;
    }
    let stop: (() => void) | null = null;
    try {
      stop = watchDownloads(
        (f) => {
          void fetchDownloadedFile(f.id)
            .then((blob) => importBlobs([blob], `Imported “${f.name}” from your Downloads folder.`))
            .catch((err: Error) => notify(`Couldn't read ${f.name}: ${err.message}`, 'error'));
        },
        (err) => setHandoffSession({ watch: { ...handoffSession().watch, on: false, error: err.message || 'The Downloads watcher stopped.' } }),
      );
      setHandoffSession({ watch: { ...handoffSession().watch, on: true, error: null } });
    } catch (err) {
      setHandoffSession({ watch: { ...handoffSession().watch, on: false, error: (err as Error).message || 'The server cannot watch Downloads.' } });
    }
    return () => {
      stop?.();
      setHandoffSession({ watch: { ...handoffSession().watch, on: false } });
    };
  }, [watchOn, anyWaiting]);

  return null;
}

/** Banner shown when an image was copied while a hand-off waits (clipboardchange). */
export function ClipboardOfferBanner() {
  const offer = useHandoffSession((s) => s.clipboardOffer);
  const pending = usePendingHandoffs();
  const active = useHandoffSession((s) => s.active);
  const [busy, setBusy] = useState(false);
  if (!offer || pending.length === 0) return null;
  const target = pending.find((p) => p.plannedId === active?.plannedId && p.planned.status === 'awaiting-handoff') ?? pending.find((p) => p.planned.status === 'awaiting-handoff');
  const accept = async () => {
    setBusy(true);
    try {
      const blob = await readClipboardImage();
      setHandoffSession({ clipboardOffer: false });
      if (!blob) notify('The clipboard has no image any more — copy it again or drop the file.', 'info');
      else await importBlobs([blob]);
    } catch (err) {
      notify(`Couldn't read the clipboard: ${(err as Error).message || 'permission denied'}. Paste with ⌘V / Ctrl+V instead.`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pointer-events-auto absolute top-3 left-1/2 z-40 flex w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-2 rounded-xl bg-surface px-3 py-2 shadow-panel ring-1 ring-line" role="status">
      <ClipboardPaste className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-xs text-text">
        Import the copied image{target ? <> as <span className="font-semibold">“{target.planned.title}”</span></> : ''}?
      </span>
      <button type="button" onClick={() => void accept()} disabled={busy} className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60">
        Import
      </button>
      <button type="button" onClick={() => setHandoffSession({ clipboardOffer: false })} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Drag & drop onto the Studio center while hand-offs are pending: handlers + overlay. */
export function useHandoffDrop() {
  const pending = usePendingHandoffs();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const enabled = pending.length > 0;
  const waiting = pending.filter((p) => p.planned.status === 'awaiting-handoff');

  const handlers = enabled
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!dragLooksImportable(e.dataTransfer)) return;
          e.preventDefault();
          depth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!dragLooksImportable(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!dragLooksImportable(e.dataTransfer)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          void transferImages(e.dataTransfer)
            .then((blobs) => importBlobs(blobs))
            .catch((err: Error) => notify(err.message, 'error'));
        },
      }
    : {};

  const active = handoffSession().active;
  const target = pending.find((p) => p.plannedId === active?.plannedId) ?? waiting[0] ?? pending[0];
  const overlay =
    enabled && dragging ? (
      <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-white/70 bg-black/55 backdrop-blur-sm">
        <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center text-white">
          <ImageDown className="size-8" />
          <div className="font-display text-lg">Drop the result to import it</div>
          <div className="text-xs text-white/75">
            {waiting.length > 1
              ? `One image goes to “${target?.planned.title ?? 'the waiting variation'}”; several are assigned to the ${waiting.length} waiting variations in order.`
              : target
                ? `It becomes “${target.planned.title}” — lined up with your photo, with everything outside the outline kept.`
                : ''}
          </div>
        </div>
      </div>
    ) : null;

  return { handlers, overlay };
}
