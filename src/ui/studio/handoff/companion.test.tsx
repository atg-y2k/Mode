// @vitest-environment jsdom
/**
 * Companion UI checks in jsdom: one drop on the Picture-in-Picture drop zone
 * imports once (the frame's own drop handler must not import it again), and
 * the floating card leaves the top bar clickable. Actions, packs and the
 * clipboard are mocked.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = {
  photoId: 'p1',
  generationId: 'g1',
  plannedId: 'pl1',
  index: 0,
  generation: { id: 'g1', brief: {}, planned: [] },
  planned: { id: 'pl1', status: 'staged', title: 'Planting', staged: { imageId: 'a', thumbId: 'b', source: { kind: 'handoff', app: 'chatgpt', importedAt: 0 } } },
};

const importBlobs = vi.fn(async (_b: Blob[]) => 1);
const transferImages = vi.fn(async () => [new Blob(['x'], { type: 'image/png' })]);
let paneSize = { width: 0, height: 0 };

vi.mock('./hooks', () => ({ usePendingHandoffs: () => [item] }));
vi.mock('./actions', () => ({
  importBlobs: (b: Blob[]) => importBlobs(b),
  openHandoff: vi.fn(),
  openRunHandoff: vi.fn(),
  openStaging: vi.fn(),
  retryPrepare: vi.fn(),
  skipPlanned: vi.fn(),
  switchPendingApp: vi.fn(),
}));
vi.mock('./sources', () => ({ transferImages: () => transferImages(), dragLooksImportable: () => true }));
vi.mock('./pip', () => ({ pipSupported: () => false, closeCompanionPip: vi.fn(), openCompanionPip: vi.fn() }));
vi.mock('./pack', () => ({
  ensurePack: vi.fn(async () => undefined),
  lookupPlanned: vi.fn(),
  packBlob: vi.fn(),
  packPng: vi.fn(),
  warmPack: vi.fn(),
  watermarkRisk: vi.fn(async () => false),
  targetOutlineChanged: vi.fn(() => false),
  reprepareRun: vi.fn(),
}));
vi.mock('./ImportLayer', () => ({ ClipboardOffer: () => null }));
vi.mock('./bits', () => ({ AlignmentBadge: () => null, AppIcon: () => null, useFlash: () => [false, () => undefined] }));
vi.mock('./clipboard', () => ({
  clipboardAvailable: () => false,
  eventWindow: () => window,
  openAppTab: vi.fn(),
  writeImage: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock('./log', () => ({ BUSY_DAY: 99, countToday: () => 0, recordHandoff: vi.fn(), useHandoffLog: () => [], usageHint: () => '' }));
vi.mock('./prefs', () => ({
  GEMINI_PLAN_KEY: 'g',
  setPref: vi.fn(),
  setToggle: vi.fn(),
  TEMPORARY_CHAT_KEY: 't',
  useGeminiPlan: () => 'paid',
  usePasteImage: () => 'marked',
  useToggle: () => false,
  WATCH_DOWNLOADS_KEY: 'w',
}));
vi.mock('./references', () => ({ droppedReferenceCount: () => 0, handoffReferences: () => [] }));
vi.mock('../hooks', () => ({ useBlobUrl: () => ({ url: null }), useElementSize: () => paneSize }));
vi.mock('../panels/historyTree', () => ({ OPEN_HANDOFF_EVENT: 'mode:open-handoff' }));
vi.mock('../../../lib/imageImport', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../../handoff', () => ({ CHATGPT_URL: 'x', chatgptDeepLink: () => 'x', GEMINI_APP_URL: 'y', handoffDownloadName: () => 'n', warmUpAlignment: vi.fn() }));
const state = { studio: { handoffApp: 'chatgpt', gridGenerationId: null }, selection: { photoId: 'p1' }, project: { ideaBoard: [] }, notify: vi.fn() };
vi.mock('../../../state/store', () => {
  const useStore = (sel: (s: unknown) => unknown) => sel(state);
  (useStore as unknown as { getState: () => unknown }).getState = () => state;
  return { useStore, findPhoto: () => undefined };
});

import { CompanionDock } from './Companion';
import { handoffSession, setHandoffSession } from './session';

function fireDrop(target: Element) {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [], items: [] } });
  target.dispatchEvent(ev);
}

const roots: { unmount: () => void }[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  setHandoffSession({ pip: null, companion: 'closed', active: null });
  paneSize = { width: 0, height: 0 };
});

async function mount(): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<CompanionDock />));
}

describe('Picture-in-Picture drop', () => {
  it('a drop on the drop zone inside the floating window imports once', async () => {
    const pipDoc = document.implementation.createHTMLDocument('pip');
    const fakePip = { closed: false, document: pipDoc, addEventListener: vi.fn(), removeEventListener: vi.fn(), focus: vi.fn() } as unknown as Window;
    setHandoffSession({ pip: fakePip, companion: 'open', active: { photoId: 'p1', generationId: 'g1', plannedId: 'pl1' } });
    await mount();

    const label = Array.from(pipDoc.querySelectorAll('span')).find((s) => s.textContent === 'Drop the result here');
    expect(label, 'ResultDrop rendered inside the PiP document').toBeTruthy();
    await act(async () => {
      fireDrop(label!.closest('.border-dashed')!);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(importBlobs).toHaveBeenCalledTimes(1);

    // A drop elsewhere in the frame is still imported (once) by the frame.
    importBlobs.mockClear();
    const header = Array.from(pipDoc.querySelectorAll('div')).find((d) => d.textContent === 'Hand-off')!;
    await act(async () => {
      fireDrop(header);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(importBlobs).toHaveBeenCalledTimes(1);
  });
});

describe('floating companion card', () => {
  it('is capped below the 3.5rem top bar (desktop and phone)', async () => {
    paneSize = { width: 390, height: 500 }; // a small pane: the card floats over the window
    setHandoffSession({ pip: null, companion: 'open', staging: null, active: { photoId: 'p1', generationId: 'g1', plannedId: 'pl1' } });
    await mount();
    const card = document.querySelector('[role="dialog"][aria-label="Hand-off companion"]');
    expect(card).toBeTruthy();
    const cls = card!.className;
    expect(cls).toContain('max-h-[min(42rem,calc(100dvh-5rem))]');
    expect(cls).toContain('max-sm:max-h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))]');
  });

  it('stays inside the photo pane on a laptop screen (1440×900 leaves a 759×528 pane)', async () => {
    paneSize = { width: 759, height: 528 };
    setHandoffSession({ pip: null, companion: 'open', staging: null, active: { photoId: 'p1', generationId: 'g1', plannedId: 'pl1' } });
    await mount();
    const card = document.querySelector('[role="dialog"][aria-label="Hand-off companion"]')!;
    expect(card.className).toContain('absolute');
    expect(card.className).not.toContain('fixed');
    // Rendered in the pane, not portalled over the window.
    expect(card.parentElement).not.toBe(document.body);
  });

  it('floats beside the right panel on a 1366×768 laptop (677×403 pane), tall enough for every step', async () => {
    paneSize = { width: 677, height: 403 };
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 256, y: 56, left: 256, top: 56, right: 933, bottom: 459, width: 677, height: 403, toJSON: () => ({}) } as DOMRect);
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
    try {
      setHandoffSession({ pip: null, companion: 'open', staging: null, active: { photoId: 'p1', generationId: 'g1', plannedId: 'pl1' } });
      await mount();
      const card = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Hand-off companion"]')!;
      expect(card.className).toContain('fixed');
      expect(card.className).toContain('max-h-[min(42rem,calc(100dvh-5rem))]');
      expect(card.parentElement).toBe(document.body);
      // Right edge lined up with the photo pane's (12 px in), so the right panel (x ≥ 934) and the rail stay clear.
      expect(card.style.right).toBe(`${1366 - 933 + 12}px`);
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});

describe('Esc', () => {
  it('folds the open card to its pill, but not while typing', async () => {
    paneSize = { width: 759, height: 528 };
    setHandoffSession({ pip: null, companion: 'open', staging: null, active: { photoId: 'p1', generationId: 'g1', plannedId: 'pl1' } });
    await mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(handoffSession().companion).toBe('open');
    input.blur();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => void document.body.dispatchEvent(esc));
    expect(handoffSession().companion).toBe('collapsed');
    // Handled: the Studio's own Esc (back to the original) leaves it alone.
    expect(esc.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"][aria-label="Hand-off companion"]')).toBeNull();
  });
});
