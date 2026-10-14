/**
 * The hand-off companion: the list of hand-offs still waiting and, for the
 * active one, the per-app steps — "Copy photo & open ChatGPT" (the PNG goes
 * to the clipboard inside the click, then the prefilled chat opens) or the
 * Gemini two-paste flow — plus copy-again buttons, the full prompt, a drop /
 * paste / file-picker zone for the result, the Downloads watcher and the
 * one-click switch to the other app when one hits its limits.
 *
 * Rendered inline over the Studio (a card that collapses to a pill) and,
 * when the browser supports Document Picture-in-Picture, in a floating
 * window over the ChatGPT / Gemini tab.
 */
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  FolderDown,
  ImagePlus,
  ImageUp,
  Inbox,
  Loader2,
  PictureInPicture2,
  RotateCcw,
  ScanSearch,
  SkipForward,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HandoffPack } from '../../../../shared/types';
import { CHATGPT_URL, chatgptDeepLink, GEMINI_APP_URL, handoffDownloadName, warmUpAlignment } from '../../../handoff';
import { downloadBlob } from '../../../lib/imageImport';
import { findPhoto, useStore } from '../../../state/store';
import { cn } from '../../common';
import { useBlobUrl, useElementSize } from '../hooks';
import { OPEN_HANDOFF_EVENT, type OpenHandoffDetail } from '../panels/historyTree';
import { importBlobs, openHandoff, openRunHandoff, openStaging, retryPrepare, skipPlanned, switchPendingApp } from './actions';
import { AlignmentBadge, AppIcon, useFlash } from './bits';
import { clipboardAvailable, eventWindow, openAppTab, writeImage, writeText } from './clipboard';
import { BUSY_DAY, countToday, recordHandoff, useHandoffLog, usageHint } from './log';
import { usePendingHandoffs } from './hooks';
import { ClipboardOffer } from './ImportLayer';
import { ensurePack, lookupPlanned, packBlob, packPng, reprepareRun, targetOutlineChanged, warmPack, watermarkRisk } from './pack';
import { appLabel, otherApp, sameRef, type PendingItem } from './planned';
import { closeCompanionPip, openCompanionPip, pipSupported } from './pip';
import { GEMINI_PLAN_KEY, setPref, setToggle, TEMPORARY_CHAT_KEY, useGeminiPlan, usePasteImage, useToggle, WATCH_DOWNLOADS_KEY, type GeminiPlan } from './prefs';
import { droppedReferenceCount, handoffReferences, type HandoffReference } from './references';
import { handoffSession, setHandoffSession, useHandoffSession } from './session';
import { dragLooksImportable, transferImages } from './sources';

function notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  useStore.getState().notify(message, kind);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold', done ? 'bg-success text-white' : 'bg-accent-soft text-accent')}>
      {done ? <Check className="size-3" /> : n}
    </span>
  );
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <StepNumber n={n} done={done} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-[13px] leading-snug text-text">{title}</div>
        {children}
      </div>
    </li>
  );
}

function SmallButton({ onClick, icon, children, title, done }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; icon: ReactNode; children: ReactNode; title?: string; done?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        done ? 'border-success/40 bg-success/10 text-success' : 'border-line bg-surface text-text hover:bg-surface-2',
      )}
    >
      {done ? <Check className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

/** Drop / paste / pick zone for the returned image (always visible at the bottom of the companion). */
function ResultDrop({ busy, message, highlight }: { busy: boolean; message?: string; highlight?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const onDrop = (e: DragEvent) => {
    // preventDefault marks the drop as handled for the Studio-wide drop target around the card.
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    void transferImages(e.dataTransfer)
      .then((blobs) => importBlobs(blobs))
      .catch((err: Error) => notify(err.message, 'error'));
  };
  return (
    <div
      onDragEnter={(e) => {
        if (!dragLooksImportable(e.dataTransfer)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (dragLooksImportable(e.dataTransfer)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={onDrop}
      className={cn(
        'flex min-h-14 items-center gap-2.5 rounded-xl border-2 border-dashed px-3 py-2 transition-colors',
        over ? 'border-accent bg-accent-soft' : highlight ? 'border-accent/60 bg-accent-soft/50' : 'border-line-strong bg-surface-2/50',
      )}
    >
      {busy ? (
        <span className="flex items-center gap-2 text-xs font-medium text-text">
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          {message ?? 'Lining the result up with your photo…'}
        </span>
      ) : (
        <>
          <ImageUp className={cn('size-5 shrink-0', over || highlight ? 'text-accent' : 'text-muted')} />
          <span className="min-w-0 flex-1 text-xs leading-snug text-muted">
            <span className="block font-medium text-text">Drop the result here</span>
            or paste it anywhere (⌘V / Ctrl+V)
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-text hover:bg-surface-2"
          >
            <Upload className="size-3.5" /> File…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void importBlobs(files);
            }}
          />
        </>
      )}
    </div>
  );
}

function DownloadsWatch() {
  const watch = useHandoffSession((s) => s.watch);
  const on = useToggle(WATCH_DOWNLOADS_KEY);
  if (watch.available === false) return null;
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
      <input type="checkbox" checked={on} onChange={(e) => setToggle(WATCH_DOWNLOADS_KEY, e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-medium text-text">
          <FolderDown className="size-3.5" /> Watch my Downloads folder
        </span>
        {on && watch.on ? (
          <span className="block truncate" title={watch.dir ?? undefined}>
            Watching {watch.dir ?? 'Downloads'} — a downloaded result imports by itself.
          </span>
        ) : on && watch.error ? (
          <span className="block text-warning">{watch.error}</span>
        ) : (
          <span className="block">Downloaded results import by themselves (only while a hand-off waits).</span>
        )}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Active item
// ---------------------------------------------------------------------------

/**
 * Gemini plan warning (C1): Free accounts may only get the Lite image model,
 * which isn't designed for editing photos — suggest ChatGPT. Nothing for a
 * Google AI plan (its tip sits with the others).
 */
function GeminiPlanNote({ plan, dropped, waiting }: { plan: GeminiPlan | null; dropped: number; waiting: number }) {
  if (plan === 'paid') return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-[11px] leading-snug text-text" role="note">
      <span className="flex items-start gap-1.5">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
        <span>
          <b className="font-semibold">{plan === 'free' ? 'Gemini Free' : 'On Gemini’s free plan'}, edits may be weak:</b> free accounts may only get the Lite image model, which isn’t
          designed for editing photos{dropped > 0 ? ` (your ${dropped} reference image${dropped === 1 ? ' is' : 's are'} left out)` : ''}. ChatGPT usually does better.
        </span>
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 pl-5">
        {waiting > 0 && (
          <button type="button" onClick={() => switchPendingApp('chatgpt')} className="font-semibold text-accent hover:underline">
            Use ChatGPT instead
          </button>
        )}
        <button type="button" onClick={() => setPref(GEMINI_PLAN_KEY, 'paid')} className="font-medium text-muted hover:text-text hover:underline">
          I have a Google AI plan
        </button>
      </span>
    </div>
  );
}

/** H10: the area reaches the corner where Gemini stamps its sparkle, so the composite would keep it. */
function WatermarkNote() {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-[11px] leading-snug text-text" role="note">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
      <span>
        The area reaches the <b className="font-semibold">bottom-right corner</b>, where Gemini stamps its sparkle — it would stay in the result. Turn it off in Gemini’s{' '}
        <b className="font-semibold">Settings → Media watermark</b> (not offered in the EU or South Korea), or use ChatGPT.
      </span>
    </p>
  );
}

/**
 * Runs from older saves (no frozen outline): the scene's outline changed
 * since this hand-off was prepared — imports still use the outline that was
 * pasted; preparing again switches to the current one.
 */
function OutlineChangedNote({ item }: { item: PendingItem }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-[11px] leading-snug text-text" role="note">
      <span className="flex items-start gap-1.5">
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
        <span>
          The scene outline changed since this hand-off was prepared — re-prepare? Results you bring back are still lined up with the outline you pasted.
        </span>
      </span>
      <button type="button" onClick={() => reprepareRun(item.photoId, item.generationId)} className="self-start pl-5 font-semibold text-accent hover:underline">
        Prepare it again with the current outline
      </button>
    </div>
  );
}

/** One reference image: "Copy reference N" with the prompt's own sentence about it. */
function ReferenceRow({ reference, index }: { reference: HandoffReference; index: number }) {
  const [copied, flash] = useFlash();
  const thumb = useBlobUrl(reference.imageId);
  return (
    <li className="flex items-start gap-2">
      <div className="h-10 w-12 shrink-0 overflow-hidden rounded-md bg-surface-3">
        {thumb.url && <img src={thumb.url} alt="" className="h-full w-full object-cover" draggable={false} />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <SmallButton
          onClick={(e) => writeImage(eventWindow(e), packPng(reference.imageId)).then(flash, (err: Error) => notify(`Couldn't copy the image: ${err.message || 'clipboard refused'}.`, 'error'))}
          icon={<ImagePlus className="size-3.5" />}
          done={copied}
          title={`${reference.title} — paste it after the photo, as Image ${reference.n}`}
        >
          {copied ? `Reference ${index + 1} copied` : `Copy reference ${index + 1}`}
        </SmallButton>
        <span className="text-[11px] leading-snug text-muted">{reference.sentence}</span>
      </div>
    </li>
  );
}

function ActiveItem({ item, onSent }: { item: PendingItem; onSent: (sent: boolean) => void }) {
  const job = useHandoffSession((s) => s.jobs[item.plannedId]);
  const error = useHandoffSession((s) => s.errors[item.plannedId]);
  const studioApp = useStore((s) => s.studio.handoffApp);
  const board = useStore((s) => s.project?.ideaBoard);
  const temporary = useToggle(TEMPORARY_CHAT_KEY);
  const plan = useGeminiPlan();
  const paste = usePasteImage();
  const [copiedPhoto, flashPhoto] = useFlash();
  const [copiedPrompt, flashPrompt] = useFlash();
  const [copiedMarked, flashMarked] = useFlash();
  const [copiedClean, flashClean] = useFlash();
  const [opened, setOpened] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [cornerRisk, setCornerRisk] = useState(false);
  const { planned } = item;
  const pack: HandoffPack | undefined = planned.handoff;
  const app = pack?.app ?? studioApp;
  const markedThumb = useBlobUrl(pack?.markedImageId);
  const staged = planned.status === 'staged';
  const preparing = job?.kind === 'preparing' || (!pack && !error && !staged);
  const waitingCount = usePendingHandoffs().filter((i) => i.planned.status === 'awaiting-handoff').length;
  const outlineChanged = useStore((s) => {
    const photo = findPhoto(s.project, item.photoId)?.photo;
    const g = photo?.generations.find((x) => x.id === item.generationId);
    return !!g && targetOutlineChanged(photo, g);
  });

  // Inspiration images that go along (Image 2, 3…): the brief's picks, none for Gemini without a Google AI plan.
  const brief = item.generation.brief;
  const references = useMemo(() => handoffReferences(board ?? [], brief, app, plan), [board, brief, app, plan]);
  const dropped = useMemo(() => droppedReferenceCount(board ?? [], brief, app, plan), [board, brief, app, plan]);
  const refsKey = references.map((r) => `${r.imageId}:${r.role}`).join('|');
  // Only offer what the prompt really names (ensurePack rebuilds the prompt when the list changes).
  const promptRefs = pack ? references.filter((r) => pack.prompt.includes(r.sentence)) : [];
  const marked = paste === 'marked' || !pack?.markerColor;
  const photoId = pack ? (paste === 'clean' ? pack.cleanImageId : pack.markedImageId) : undefined;

  // Prepare lazily when shown (also after a reload); warm the PNG so the copy click finds it ready.
  // A change of the pasted image or of the references rebuilds the prompt (the images are reused).
  useEffect(() => {
    if (staged || error) return;
    void ensurePack(item)
      .then(warmPack)
      .catch(() => undefined); // shown as the item's error
  }, [item.plannedId, pack?.cleanImageId, app, staged, error, refsKey, paste, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const r of references) void packPng(r.imageId).catch(() => undefined);
  }, [refsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gemini's sparkle sits bottom-right of what it returns: warn when the composite would keep that corner.
  useEffect(() => {
    let alive = true;
    setCornerRisk(false);
    const found = lookupPlanned(item);
    if (!pack || pack.app !== 'gemini' || !found) return;
    void watermarkRisk(found.photo, found.generation, pack)
      .then((risk) => alive && setCornerRisk(risk))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [item.plannedId, item.generationId, pack?.cleanImageId, pack?.app]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setOpened(false), [item.plannedId, app]);
  useEffect(() => onSent(opened), [opened, onSent]);

  const deepLink = pack && app === 'chatgpt' ? chatgptDeepLink(pack.prompt, { temporary }) : null;
  // Clipboard images need a secure context (https or localhost) — e.g. not Mode opened over plain http from a phone.
  const canCopy = clipboardAvailable(window);
  const appUrl = app === 'chatgpt' ? (deepLink ?? (temporary ? `${CHATGPT_URL}?temporary-chat=true` : CHATGPT_URL)) : GEMINI_APP_URL;

  /** Clipboard write first (synchronously, PNG as a promise), then the app tab — no await before write(). */
  const copyAndOpen = (e: MouseEvent<HTMLButtonElement>) => {
    if (!pack || !photoId) return;
    const win = eventWindow(e);
    if (!canCopy) {
      openAppTab(win, appUrl);
      recordHandoff(app, planned.id);
      setOpened(true);
      void download();
      return;
    }
    const copy = writeImage(win, packPng(photoId));
    openAppTab(win, appUrl);
    recordHandoff(app, planned.id);
    setOpened(true);
    copy.then(flashPhoto, (err: Error) =>
      notify(`Couldn't copy the photo (${err.message || 'clipboard refused'}). Use “Download” below and attach the file in ${appLabel(app)}.`, 'error'),
    );
  };
  const copyImage = (e: MouseEvent<HTMLButtonElement>, id: string, done: () => void) => {
    writeImage(eventWindow(e), packPng(id)).then(done, (err: Error) => notify(`Couldn't copy the image: ${err.message || 'clipboard refused'}.`, 'error'));
  };
  const copyPrompt = (e: MouseEvent<HTMLButtonElement>) => {
    if (!pack) return;
    writeText(eventWindow(e), pack.prompt).then(flashPrompt, () => notify("Couldn't copy the prompt — select it below and copy it by hand.", 'error'));
  };
  const download = async () => {
    if (!pack || !photoId) return;
    try {
      const blob = await packBlob(photoId);
      downloadBlob(blob, handoffDownloadName(planned.title, blob.type === 'image/png' ? 'png' : 'jpg'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const photoWord = marked ? 'the marked photo' : 'the photo';
  const steps: { title: ReactNode; done?: boolean; body?: ReactNode }[] = [];
  steps.push({
    done: opened,
    title:
      app === 'chatgpt'
        ? deepLink
          ? `Copy ${photoWord} and open a new ChatGPT chat — the prompt is already typed in.`
          : `Copy ${photoWord} and open a new ChatGPT chat.`
        : `Copy ${photoWord} and open a new Gemini chat.`,
    body: (
      <>
        <button
          type="button"
          onClick={copyAndOpen}
          disabled={!pack || preparing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {preparing ? <Loader2 className="size-4 animate-spin" /> : copiedPhoto ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
          {preparing ? 'Preparing the photo…' : `${canCopy ? 'Copy' : 'Save'} photo & open ${appLabel(app)}`}
          {!preparing && <ExternalLink className="size-3.5 opacity-70" />}
        </button>
        {!canCopy && (
          <span className="text-[11px] leading-snug text-warning">
            Copying images needs https or localhost, so the photo is saved to your Downloads — attach it in {appLabel(app)} with + or drag it in.
          </span>
        )}
        {app === 'chatgpt' && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={temporary} onChange={(e) => setToggle(TEMPORARY_CHAT_KEY, e.target.checked)} className="accent-[var(--accent)]" />
            Temporary chat (kept out of your ChatGPT history)
          </label>
        )}
      </>
    ),
  });
  const pastePhoto = 'Paste the photo into the message box (⌘V / Ctrl+V)';
  if (promptRefs.length > 0) {
    steps.push({
      title: `${pastePhoto}, then add the reference image${promptRefs.length === 1 ? '' : 's'} after it, in order — the prompt calls ${promptRefs.length === 1 ? 'it Image 2' : `them Image 2–${promptRefs.length + 1}`}.`,
      body: (
        <ul className="flex flex-col gap-2">
          {promptRefs.map((r, i) => (
            <ReferenceRow key={r.itemId} reference={r} index={i} />
          ))}
        </ul>
      ),
    });
  }
  if (app === 'chatgpt' && deepLink) {
    steps.push({
      title: promptRefs.length ? 'Check the prompt is there and press Enter.' : `${pastePhoto} and press Enter.`,
      body: <span className="text-[11px] text-muted">Prompt didn’t appear? Use Copy prompt below and paste it after the photo.</span>,
    });
  } else {
    steps.push({
      title: promptRefs.length
        ? `Copy the prompt, paste it after the images and ${app === 'chatgpt' ? 'press Enter' : 'send'}.`
        : `${pastePhoto}, then copy the prompt, paste it after the photo and ${app === 'chatgpt' ? 'press Enter' : 'send'}.`,
      body: (
        <SmallButton onClick={copyPrompt} icon={<Copy className="size-3.5" />} done={copiedPrompt}>
          {copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
        </SmallButton>
      ),
    });
  }
  steps.push({
    title:
      app === 'gemini'
        ? 'When the image is ready, click Download full size — never right-click → Save or Copy (that is a small preview) — then drop or paste it below.'
        : 'When the image is ready, download it (or Copy image), then drop or paste it below.',
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-3">
          {markedThumb.url ? (
            <img src={markedThumb.url} alt="Marked photo" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="grid h-full w-full place-items-center">{preparing && <Loader2 className="size-4 animate-spin text-muted" />}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-muted">
            Variation {item.index + 1} of {item.generation.planned?.length ?? 1}
            {item.generation.mode === 'compare' && ' · compare run'}
          </div>
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-text" title={planned.brief}>
            {planned.title}
          </div>
          {planned.optionLabel && planned.optionLabel !== planned.title && <div className="text-xs text-accent">{planned.optionLabel}</div>}
        </div>
      </div>

      {staged ? (
        <div className="flex flex-col gap-2 rounded-xl bg-accent-soft p-3">
          <div className="text-sm font-medium text-text">Back from {appLabel(planned.staged?.source.app ?? app)} — waiting for your review.</div>
          {planned.staged?.source.alignment && <AlignmentBadge report={planned.staged.source.alignment} className="self-start" />}
          <button
            type="button"
            onClick={() => openStaging(item)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            <ScanSearch className="size-4" /> Review the result
          </button>
          <span className="text-[11px] text-muted">Dropping another image replaces it.</span>
        </div>
      ) : error ? (
        <div className="flex flex-col gap-2 rounded-xl bg-danger-soft p-3 text-xs text-danger">
          <span className="flex items-start gap-1.5">
            <TriangleAlert className="mt-px size-3.5 shrink-0" /> {error}
          </span>
          <button type="button" onClick={() => retryPrepare(item)} className="inline-flex h-7 items-center gap-1 self-start rounded-md bg-surface px-2 font-medium text-text shadow-sm">
            <RotateCcw className="size-3.5" /> Try again
          </button>
        </div>
      ) : (
        <>
          {outlineChanged && <OutlineChangedNote item={item} />}
          {app === 'gemini' && <GeminiPlanNote plan={plan} dropped={dropped} waiting={waitingCount} />}
          {cornerRisk && <WatermarkNote />}
          <ol className="flex flex-col gap-3">
            {steps.map((st, i) => (
              <Step key={i} n={i + 1} done={st.done} title={st.title}>
                {st.body}
              </Step>
            ))}
          </ol>
        </>
      )}

      {pack && !staged && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {deepLink && (
              // Without a prefill link the prompt button is already a step.
              <SmallButton onClick={copyPrompt} icon={<Copy className="size-3.5" />} done={copiedPrompt} title="The full prompt for this variation">
                Copy prompt
              </SmallButton>
            )}
            {pack.markerColor && (
              <SmallButton onClick={(e) => copyImage(e, pack.markedImageId, flashMarked)} icon={<ClipboardCopy className="size-3.5" />} done={copiedMarked} title="The photo with the area outlined">
                Marked photo
              </SmallButton>
            )}
            <SmallButton
              onClick={(e) => copyImage(e, pack.cleanImageId, flashClean)}
              icon={<ClipboardCopy className="size-3.5" />}
              done={copiedClean}
              title={pack.markerColor ? 'The same crop without the outline' : 'The photo to paste'}
            >
              {pack.markerColor ? 'Clean photo' : 'Photo'}
            </SmallButton>
            <SmallButton onClick={() => void download()} icon={<Download className="size-3.5" />} title={`Save ${photoWord} to attach it as a file`}>
              Download
            </SmallButton>
          </div>
          <button
            type="button"
            onClick={() => setShowPrompt((x) => !x)}
            aria-expanded={showPrompt}
            className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-muted hover:text-text"
          >
            {showPrompt ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {showPrompt ? 'Hide the prompt' : `Show the prompt (${pack.prompt.length} characters)`}
          </button>
          {showPrompt && (
            <p className="max-h-48 overflow-y-auto rounded-lg bg-surface-2 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-text select-text">{pack.prompt}</p>
          )}
          <ul className="flex flex-col gap-0.5 text-[11px] leading-snug text-muted">
            <li>
              {item.generation.mode === 'compare'
                ? '· Compare run: start every option in a new chat from this same photo — never from another option’s result.'
                : '· A new chat for each variation keeps results clean.'}
            </li>
            {pack.markerColor &&
              (marked ? (
                <li>· Leave the outline in — the prompt tells {appLabel(app)} to remove it, and Mode puts your photo back around the area.</li>
              ) : (
                <li>· You’re pasting the clean photo (Settings → Hand-off) — the prompt names the area in words.</li>
              ))}
            {app === 'chatgpt' && <li>· Optional: touch up the result in the same chat with ChatGPT’s Edit tools (Comment or Markup).</li>}
            {app === 'gemini' && plan === 'paid' && (
              <li>· Flash and Pro in the chat both make images with Nano Banana 2; for Nano Banana Pro, use More → Redo with Pro once the image appears.</li>
            )}
          </ul>
        </div>
      )}

      {!staged && (
        <button
          type="button"
          onClick={() => skipPlanned(item)}
          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-muted hover:text-danger"
          title="Don't make this variation"
        >
          <SkipForward className="size-3.5" /> Skip this variation
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function CompanionPanel({ variant, onCollapse }: { variant: 'inline' | 'pip'; onCollapse?: () => void }) {
  const items = usePendingHandoffs();
  const activeRef = useHandoffSession((s) => s.active);
  const jobs = useHandoffSession((s) => s.jobs);
  const pip = useHandoffSession((s) => s.pip);
  const studioApp = useStore((s) => s.studio.handoffApp);
  const log = useHandoffLog();
  const active = items.find((i) => sameRef(i, activeRef)) ?? items.find((i) => i.planned.status === 'awaiting-handoff') ?? items[0];
  const waiting = items.filter((i) => i.planned.status === 'awaiting-handoff');
  const app = active?.planned.handoff?.app ?? studioApp;
  const today = countToday(log, app);
  const hint = usageHint(app, today);
  const other = otherApp(app);
  const activeJob = active ? jobs[active.plannedId] : undefined;
  const [sent, setSent] = useState(false);

  if (!active) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted">
        <Check className="size-5 text-success" />
        Nothing is waiting for a hand-off.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <AppIcon app={app} className="size-4 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] leading-tight text-text">Hand-off</div>
          <div className="text-[11px] text-muted">
            {waiting.length} waiting{items.length > waiting.length ? ` · ${items.length - waiting.length} back` : ''}
          </div>
        </div>
        {variant === 'inline' && pipSupported() && (
          <button
            type="button"
            onClick={() => void (pip ? closeCompanionPip() : openCompanionPip())}
            className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
            title="Float this card over the ChatGPT / Gemini tab (Picture-in-Picture)"
            aria-label="Open the floating hand-off window"
          >
            <PictureInPicture2 className="size-4" />
          </button>
        )}
        {onCollapse && (
          <button type="button" onClick={onCollapse} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label="Collapse the hand-off card" title="Collapse">
            <ChevronUp className="size-4" />
          </button>
        )}
      </header>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {items.length > 1 && (
          <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Hand-offs of this project">
            {items.map((i, n) => {
              const selected = i === active;
              const busy = jobs[i.plannedId];
              const status =
                i.planned.status === 'staged' ? 'back — review it' : busy ? (busy.kind === 'importing' ? 'lining up…' : 'preparing…') : 'waiting';
              return (
                <button
                  key={`${i.generationId}:${i.plannedId}`}
                  type="button"
                  role="listitem"
                  onClick={() => openHandoff(i)}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`${i.planned.optionLabel || i.planned.title} — ${status}`}
                  title={`${i.planned.optionLabel || i.planned.title} — ${status}`}
                  className={cn(
                    'relative inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-semibold transition-colors',
                    selected ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-text',
                    busy && 'animate-pulse',
                  )}
                >
                  {i.planned.status === 'staged' ? <ScanSearch className="size-3.5" /> : n + 1}
                  {i.planned.status === 'staged' && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-surface" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <ClipboardOffer variant="card" />
        <ActiveItem item={active} onSent={setSent} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-3.5 pt-2.5 pb-3">
        <ResultDrop busy={activeJob?.kind === 'importing'} message={activeJob?.message} highlight={sent} />
        <DownloadsWatch />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {hint && <span>{hint}.</span>}
          {waiting.length > 0 && (
            <button
              type="button"
              onClick={() => switchPendingApp(other)}
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              title={`Prepare the ${waiting.length} waiting variation${waiting.length === 1 ? '' : 's'} for ${appLabel(other)} instead`}
            >
              <ArrowLeftRight className="size-3" />
              {today >= BUSY_DAY ? `Hit a limit? Switch ${waiting.length} to ${appLabel(other)}` : `Switch waiting to ${appLabel(other)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Below this size of the photo pane the open card floats (phones: a bottom
 * sheet; larger screens: lined up with the photo pane's right edge, never
 * over the right panel or its tab rail, tall enough for all three steps and
 * the drop zone). Above it the card sits inside the photo pane and scrolls
 * within it. 1440×900 leaves a 759×528 pane (inline); 1366×768 a 677×403 one,
 * where an inline card would show only step 1 (floats).
 */
export const FLOAT_BELOW = { width: 480, height: 500 };

/** Phones (below Tailwind's sm): the floating card is a bottom sheet over the bottom nav. */
const PHONE_QUERY = '(max-width: 639px)';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Inline host: card / collapsed pill over the Studio (floating when the pane is too small), plus the PiP portal. */
export function CompanionDock() {
  const items = usePendingHandoffs();
  const companion = useHandoffSession((s) => s.companion);
  const pip = useHandoffSession((s) => s.pip);
  const staging = useHandoffSession((s) => s.staging);
  const activeRef = useHandoffSession((s) => s.active);
  const photoId = useStore((s) => s.selection.photoId);
  const waiting = items.filter((i) => i.planned.status === 'awaiting-handoff').length;
  const back = items.length - waiting;

  // Nothing pending: close the floating window. Leaving the Studio closes it too (it renders from here).
  useEffect(() => {
    if (items.length === 0 && pip) closeCompanionPip();
  }, [items.length, pip]);
  useEffect(
    () => () => {
      if (handoffSession().pip) closeCompanionPip();
    },
    [],
  );

  // History → "Open hand-off" on a run: open the companion on its pending items (the panel's fallback is skipped).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<OpenHandoffDetail>).detail?.generationId;
      if (id && openRunHandoff(id)) e.preventDefault();
    };
    window.addEventListener(OPEN_HANDOFF_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HANDOFF_EVENT, onOpen);
  }, []);

  // The user will bring an image back soon: start loading the alignment engine (OpenCV) now.
  const shown = items.length > 0 && (companion === 'open' || !!pip);
  useEffect(() => {
    if (shown) warmUpAlignment();
  }, [shown]);

  // Opening a run side by side makes room: the card folds to its pill (opening a hand-off from the grid unfolds it).
  const gridId = useStore((s) => s.studio.gridGenerationId);
  useEffect(() => {
    if (gridId && handoffSession().companion === 'open') setHandoffSession({ companion: 'collapsed' });
  }, [gridId]);

  // A short or narrow photo pane (phones, 768 px-tall laptops, small windows) can't hold the steps: the card floats instead.
  const paneRef = useRef<HTMLDivElement>(null);
  const pane = useElementSize(paneRef);
  const floating = pane.width > 0 && (pane.width < FLOAT_BELOW.width || pane.height < FLOAT_BELOW.height);

  const open = items.length > 0 && companion === 'open' && !pip && !staging;

  // Floating on a larger screen: lined up with the photo pane's right edge (the right panel and its tab rail stay clickable).
  const [anchor, setAnchor] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const place = () => {
      const el = paneRef.current;
      if (!el || window.matchMedia?.(PHONE_QUERY).matches) {
        setAnchor(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const right = Math.max(8, Math.round(window.innerWidth - r.right + 12));
      setAnchor({ right, maxWidth: Math.max(240, Math.round(r.width - 24)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, floating, pane.width, pane.height]);

  // Esc folds the open card to its pill (before the Studio's own Esc, which goes back to the original).
  // Listens on the document: Popover / sketch handlers that claim Esc stop it earlier; dialogs, staging and typing are left alone.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (document.querySelector('[aria-modal="true"]') || handoffSession().staging) return;
      e.preventDefault();
      setHandoffSession({ companion: 'collapsed' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // The pill: the card's own item when it belongs to the photo on screen, else the first item here, else the first anywhere (switching photo on this click is fine).
  const openFromPill = () => {
    if (pip) {
      pip.focus();
      return;
    }
    const isWaiting = (i: PendingItem) => i.planned.status === 'awaiting-handoff';
    const current = items.find((i) => sameRef(i, activeRef));
    const here = items.filter((i) => i.photoId === photoId);
    const target = (current && current.photoId === photoId ? current : undefined) ?? here.find(isWaiting) ?? here[0] ?? current ?? items.find(isWaiting) ?? items[0];
    if (target && target === current && target.planned.status === 'awaiting-handoff') setHandoffSession({ companion: 'open' });
    else if (target) openHandoff(target);
    else setHandoffSession({ companion: 'open' });
  };

  const portal = pip && !pip.closed ? createPortal(<PipFrame />, pip.document.body) : null;
  const card = (className: string, style?: CSSProperties) => (
    <div
      className={cn('flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-panel', className)}
      style={style}
      role="dialog"
      aria-label="Hand-off companion"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <CompanionPanel variant="inline" onCollapse={() => setHandoffSession({ companion: 'collapsed' })} />
    </div>
  );

  return (
    <>
      <div ref={paneRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {portal}
      {items.length === 0 ? null : open ? (
        floating ? (
          createPortal(
            // Capped below the 3.5rem top bar (+0.5rem gap) so Settings, undo and Fine-tune stay clickable:
            // sm+ 1rem bottom + 3.5rem + 0.5rem; phones 4.5rem bottom-nav offset + 3.5rem + 0.5rem.
            // sm+: `anchor` lines its right edge up with the photo pane's (inline style overrides right-4).
            card(
              'fixed z-40 right-4 bottom-4 w-[22rem] max-h-[min(42rem,calc(100dvh-5rem))] max-sm:inset-x-2 max-sm:w-auto max-sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-sm:max-h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))]',
              anchor ?? undefined,
            ),
            document.body,
          )
        ) : (
          card('absolute z-30 top-[3.75rem] right-3 w-[22rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-4.5rem)]')
        )
      ) : (
        !staging && (
          <button
            type="button"
            onClick={openFromPill}
            onPointerDown={(e) => e.stopPropagation()}
            // Bottom right of the photo, just above the zoom controls (clear of the side-by-side header).
            className="absolute z-30 inline-flex h-9 items-center gap-2 rounded-full bg-accent pr-3 pl-2.5 text-xs font-semibold text-accent-fg shadow-lg transition-colors hover:bg-accent-hover max-sm:right-3 max-sm:bottom-3 sm:right-3 sm:bottom-[3.75rem]"
            title={pip ? 'The hand-off card is floating in its own window' : 'Open the hand-off card'}
            aria-label={`${waiting > 0 ? `${waiting} hand-off${waiting === 1 ? '' : 's'} waiting` : ''}${waiting > 0 && back > 0 ? ', ' : ''}${back > 0 ? `${back} back for review` : ''} — open the hand-off card`}
          >
            {pip ? <PictureInPicture2 className="size-4" /> : <ChevronDown className="size-4" />}
            {waiting > 0 ? `${waiting} hand-off${waiting === 1 ? '' : 's'} waiting` : `${back} back for review`}
            {waiting > 0 && back > 0 && <span className="rounded-full bg-white/20 px-1.5">{back} back</span>}
          </button>
        )
      )}
    </>
  );
}

/**
 * The prompt dock's "2 hand-offs waiting · 1 back" pill: opens the hand-off
 * card, and folds it again while it is open — a card floating over a short
 * window (1366×768) covers part of the dock, and this pill stays in reach.
 */
export function HandoffDockPill({ waiting, back }: { waiting: number; back: number }) {
  const open = useHandoffSession((s) => s.companion === 'open' && !s.pip && !s.staging);
  return (
    <button
      type="button"
      onClick={() => setHandoffSession(open ? { companion: 'collapsed' } : { companion: 'open', staging: null })}
      aria-expanded={open}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 text-xs font-semibold text-accent hover:brightness-95"
      title={open ? 'Collapse the hand-off card' : 'Open the hand-off card'}
    >
      <Inbox className="size-3.5" />
      {waiting > 0 && `${waiting} hand-off${waiting === 1 ? '' : 's'} waiting`}
      {waiting > 0 && back > 0 && ' · '}
      {back > 0 && `${back} back`}
    </button>
  );
}

/** Content of the Picture-in-Picture window: the panel full-height + window-wide paste / drop. */
function PipFrame() {
  const pip = useHandoffSession((s) => s.pip);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!pip) return;
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const hasImage = Array.from(dt.items ?? []).some((i) => i.kind === 'file') || (dt.files?.length ?? 0) > 0;
      if (!hasImage) return;
      e.preventDefault();
      void transferImages(dt)
        .then((blobs) => importBlobs(blobs))
        .catch((err: Error) => notify(err.message, 'error'));
    };
    pip.addEventListener('paste', onPaste);
    return () => pip.removeEventListener('paste', onPaste);
  }, [pip]);
  return (
    <div
      className="relative flex h-full flex-col bg-surface text-text"
      onDragOver={(e) => {
        if (!dragLooksImportable(e.dataTransfer)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        // Already imported by a drop zone inside the frame (ResultDrop).
        if (e.defaultPrevented) return;
        e.preventDefault();
        void transferImages(e.dataTransfer)
          .then((blobs) => importBlobs(blobs))
          .catch((err: Error) => notify(err.message, 'error'));
      }}
    >
      <CompanionPanel variant="pip" />
      {over && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-semibold text-accent">
          Drop to import into Mode
        </div>
      )}
      <button
        type="button"
        onClick={() => closeCompanionPip()}
        className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        aria-label="Close the floating window"
        title="Back into Mode"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
