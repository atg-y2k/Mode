// @vitest-environment jsdom
/**
 * "Import copied image?" must not be offered for Mode's own clipboard writes
 * (clipboardchange fires for the page's own writes too): the photo / a
 * reference / the marked or clean copy. Events that arrive after Mode lost
 * the focus are never suppressed (the user may have copied the result).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const waiting = { photoId: 'p', generationId: 'g', plannedId: 'a', index: 0, generation: { id: 'g' }, planned: { id: 'a', title: 'Flagstone', status: 'awaiting-handoff' } };
vi.mock('./hooks', () => ({ usePendingHandoffs: () => [waiting] }));
vi.mock('./actions', () => ({ importBlobs: vi.fn(async () => 1) }));
vi.mock('./pack', () => ({ sweepFinishedPacks: vi.fn(() => 0) }));
vi.mock('../../../lib/handoff', () => ({
  fetchDownloadedFile: vi.fn(),
  handoffWatchStatus: vi.fn(async () => ({ available: false, dir: null })),
  watchDownloads: vi.fn(() => () => undefined),
}));

import { isOwnClipboardChange, OWN_WRITE_WINDOW_MS, samePrint, writeImage } from './clipboard';
import { HandoffImportEffects } from './ImportLayer';
import { handoffSession, setHandoffSession } from './session';

/** A clipboard that supports clipboardchange (Chromium 144+). */
function fakeClipboard() {
  const target = new EventTarget() as EventTarget & { onclipboardchange: null; write: ReturnType<typeof vi.fn> };
  target.onclipboardchange = null;
  let settle: () => void = () => undefined;
  target.write = vi.fn(() => new Promise<void>((r) => (settle = r)));
  return { clipboard: target, settle: () => settle() };
}

function clipboardChange(types: string[]): Event {
  return Object.assign(new Event('clipboardchange'), { types });
}

let fake: ReturnType<typeof fakeClipboard>;
beforeEach(() => {
  fake = fakeClipboard();
  Object.defineProperty(window.navigator, 'clipboard', { value: fake.clipboard, configurable: true });
  (window as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
    constructor(readonly items: Record<string, unknown>) {}
  };
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  setHandoffSession({ clipboardOffer: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Mode’s own clipboard writes', () => {
  it('count as Mode’s own while in flight and shortly after; never once Mode lost the focus', async () => {
    const png = Promise.resolve(new Blob(['p'], { type: 'image/png' }));
    const write = writeImage(window, png);
    expect(isOwnClipboardChange()).toBe(true);
    fake.settle();
    await write;
    expect(isOwnClipboardChange()).toBe(true);
    expect(isOwnClipboardChange(performance.now() + OWN_WRITE_WINDOW_MS + 100)).toBe(false);
    // A new copy, then the user switches to the ChatGPT tab.
    void writeImage(window, png);
    window.dispatchEvent(new Event('blur'));
    expect(isOwnClipboardChange()).toBe(false);
  });

  it('do not show the import offer; a copy made while Mode was in the background does', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<HandoffImportEffects />));

    // "Copy reference 1" while Mode has the focus.
    void writeImage(window, Promise.resolve(new Blob(['r'], { type: 'image/png' })));
    await act(async () => void fake.clipboard.dispatchEvent(clipboardChange(['image/png'])));
    expect(handoffSession().clipboardOffer).toBe(false);

    // The user went to ChatGPT and copied the result there; the event arrives when Mode is back.
    window.dispatchEvent(new Event('blur'));
    await act(async () => void fake.clipboard.dispatchEvent(clipboardChange(['image/png'])));
    expect(handoffSession().clipboardOffer).toBe(true);
    await act(async () => root.unmount());
  });
});

describe('image fingerprints', () => {
  const print = (fill: number, w = 1536, h = 1024) => ({ width: w, height: h, gray: new Uint8Array(256).fill(fill) });
  it('match the same picture, not an edited one or another size', () => {
    expect(samePrint(print(100), print(101))).toBe(true);
    const edited = print(100);
    edited.gray.fill(160, 40, 60); // an edit covering a few cells
    expect(samePrint(print(100), edited)).toBe(false);
    expect(samePrint(print(100), print(100, 1024, 1024))).toBe(false);
  });
});
