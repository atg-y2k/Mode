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
  ImageUp,
  Loader2,
  PictureInPicture2,
  RotateCcw,
  ScanSearch,
  SkipForward,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HandoffPack } from '../../../../shared/types';
import { CHATGPT_URL, chatgptDeepLink, GEMINI_APP_URL } from '../../../handoff';
import { downloadBlob } from '../../../lib/imageImport';
import { useStore } from '../../../state/store';
import { cn } from '../../common';
import { useBlobUrl, useElementSize } from '../hooks';
import { importBlobs, openHandoff, openStaging, retryPrepare, skipPlanned, switchPendingApp } from './actions';
import { AlignmentBadge, AppIcon, useFlash } from './bits';
import { clipboardAvailable, eventWindow, openAppTab, writeImage, writeText } from './clipboard';
import { BUSY_DAY, countToday, recordHandoff, useHandoffLog, usageHint } from './log';
import { usePendingHandoffs } from './hooks';
import { ClipboardOffer } from './ImportLayer';
import { ensurePack, packBlob, packPng, warmPack } from './pack';
import { appLabel, otherApp, sameRef, type PendingItem } from './planned';
import { closeCompanionPip, openCompanionPip, pipSupported } from './pip';
import { TEMPORARY_CHAT_KEY, setToggle, useToggle, WATCH_DOWNLOADS_KEY } from './prefs';
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

function ActiveItem({ item, onSent }: { item: PendingItem; onSent: (sent: boolean) => void }) {
  const job = useHandoffSession((s) => s.jobs[item.plannedId]);
  const error = useHandoffSession((s) => s.errors[item.plannedId]);
  const studioApp = useStore((s) => s.studio.handoffApp);
  const temporary = useToggle(TEMPORARY_CHAT_KEY);
  const [copiedPhoto, flashPhoto] = useFlash();
  const [copiedPrompt, flashPrompt] = useFlash();
  const [copiedMarked, flashMarked] = useFlash();
  const [copiedClean, flashClean] = useFlash();
  const [opened, setOpened] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const { planned } = item;
  const pack: HandoffPack | undefined = planned.handoff;
  const app = pack?.app ?? studioApp;
  const markedThumb = useBlobUrl(pack?.markedImageId);
  const staged = planned.status === 'staged';
  const preparing = job?.kind === 'preparing' || (!pack && !error && !staged);

  // Prepare lazily when shown (also after a reload); warm the PNG so the copy click finds it ready.
  useEffect(() => {
    if (staged || error) return;
    void ensurePack(item)
      .then(warmPack)
      .catch(() => undefined); // shown as the item's error
  }, [item.plannedId, pack?.cleanImageId, app, staged, error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setOpened(false), [item.plannedId, app]);
  useEffect(() => onSent(opened), [opened, onSent]);

  const deepLink = pack && app === 'chatgpt' ? chatgptDeepLink(pack.prompt, { temporary }) : null;
  // Clipboard images need a secure context (https or localhost) — e.g. not Mode opened over plain http from a phone.
  const canCopy = clipboardAvailable(window);
  const appUrl = app === 'chatgpt' ? (deepLink ?? (temporary ? `${CHATGPT_URL}?temporary-chat=true` : CHATGPT_URL)) : GEMINI_APP_URL;

  /** Clipboard write first (synchronously, PNG as a promise), then the app tab — no await before write(). */
  const copyAndOpen = (e: MouseEvent<HTMLButtonElement>) => {
    if (!pack) return;
    const win = eventWindow(e);
    if (!canCopy) {
      openAppTab(win, appUrl);
      recordHandoff(app, planned.id);
      setOpened(true);
      void download();
      return;
    }
    const copy = writeImage(win, packPng(pack.markedImageId));
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
    if (!pack) return;
    try {
      const blob = await packBlob(pack.markedImageId);
      downloadBlob(blob, `mode-handoff-${planned.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'photo'}.png`);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

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
        <ol className="flex flex-col gap-3">
          <Step
            n={1}
            done={opened}
            title={
              app === 'chatgpt'
                ? deepLink
                  ? 'Copy the photo and open a new ChatGPT chat — the prompt is already typed in.'
                  : 'Copy the photo and open a new ChatGPT chat.'
                : 'Copy the photo and open a new Gemini chat.'
            }
          >
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
          </Step>
          {app === 'chatgpt' ? (
            deepLink ? (
              <Step n={2} title={<>Paste the photo into the message box (⌘V / Ctrl+V) and press Enter.</>}>
                <span className="text-[11px] text-muted">Prompt didn’t appear? Use Copy prompt below and paste it after the photo.</span>
              </Step>
            ) : (
              <Step n={2} title="Paste the photo, then copy the prompt and paste it after the photo. Press Enter.">
                <SmallButton onClick={copyPrompt} icon={<Copy className="size-3.5" />} done={copiedPrompt}>
                  {copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
                </SmallButton>
              </Step>
            )
          ) : (
            <Step n={2} title="Paste the photo, then copy the prompt, paste it after the photo and send.">
              <SmallButton onClick={copyPrompt} icon={<Copy className="size-3.5" />} done={copiedPrompt}>
                {copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
              </SmallButton>
            </Step>
          )}
          <Step
            n={3}
            title={
              app === 'gemini'
                ? 'When the image is ready, use Download full size (right-click copy is only a small preview), then drop or paste it below.'
                : 'When the image is ready, download it (or Copy image), then drop or paste it below.'
            }
          />
        </ol>
      )}

      {pack && !staged && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {deepLink && (
              // Without a prefill link the prompt button is already step 2.
              <SmallButton onClick={copyPrompt} icon={<Copy className="size-3.5" />} done={copiedPrompt} title="The full prompt for this variation">
                Copy prompt
              </SmallButton>
            )}
            <SmallButton onClick={(e) => copyImage(e, pack.markedImageId, flashMarked)} icon={<ClipboardCopy className="size-3.5" />} done={copiedMarked} title="The photo with the area outlined">
              Marked photo
            </SmallButton>
            <SmallButton onClick={(e) => copyImage(e, pack.cleanImageId, flashClean)} icon={<ClipboardCopy className="size-3.5" />} done={copiedClean} title="The same crop without the outline">
              Clean photo
            </SmallButton>
            <SmallButton onClick={() => void download()} icon={<Download className="size-3.5" />} title="Save the marked photo to attach it as a file">
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
            {app === 'gemini' ? (
              <li>· Pick a Pro / Thinking image model if you have one — not Flash-Lite.</li>
            ) : (
              <li>· Leave the outline in — the prompt tells ChatGPT to remove it.</li>
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

/** Below this size of the photo pane the open card floats over the window (bottom right / bottom sheet). */
const FLOAT_BELOW = { width: 640, height: 560 };

/** Inline host: card / collapsed pill over the Studio (floating over the window when the pane is small), plus the PiP portal. */
export function CompanionDock() {
  const items = usePendingHandoffs();
  const companion = useHandoffSession((s) => s.companion);
  const pip = useHandoffSession((s) => s.pip);
  const staging = useHandoffSession((s) => s.staging);
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

  // Opening a run side by side makes room: the card folds to its pill (opening a hand-off from the grid unfolds it).
  const gridId = useStore((s) => s.studio.gridGenerationId);
  useEffect(() => {
    if (gridId && handoffSession().companion === 'open') setHandoffSession({ companion: 'collapsed' });
  }, [gridId]);

  // A short or narrow photo pane (phones, small laptop screens) can't hold the steps: the card floats over the window instead.
  const paneRef = useRef<HTMLDivElement>(null);
  const pane = useElementSize(paneRef);
  const floating = pane.width > 0 && (pane.width < FLOAT_BELOW.width || pane.height < FLOAT_BELOW.height);

  const portal = pip && !pip.closed ? createPortal(<PipFrame />, pip.document.body) : null;
  const open = items.length > 0 && companion === 'open' && !pip && !staging;
  const card = (className: string) => (
    <div
      className={cn('flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-panel', className)}
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
            card(
              'fixed z-40 right-4 bottom-4 w-[22rem] max-h-[min(42rem,calc(100dvh-2rem))] max-sm:inset-x-2 max-sm:w-auto max-sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-sm:max-h-[calc(100dvh-6rem)]',
            ),
            document.body,
          )
        ) : (
          card('absolute z-30 top-[3.75rem] right-3 w-[22rem] max-h-[calc(100%-4.5rem)]')
        )
      ) : (
        !staging && (
          <button
            type="button"
            onClick={() => (pip ? pip.focus() : setHandoffSession({ companion: 'open' }))}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-30 inline-flex h-9 items-center gap-2 rounded-full bg-accent pr-3 pl-2.5 text-xs font-semibold text-accent-fg shadow-lg transition-colors hover:bg-accent-hover max-sm:right-3 max-sm:bottom-3 sm:top-[3.75rem] sm:right-3"
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
        e.preventDefault();
        setOver(false);
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
