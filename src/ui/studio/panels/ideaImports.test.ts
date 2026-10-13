// @vitest-environment node
/**
 * Idea-board imports are slow (decode, downscale, palette); when the user
 * opens another project meanwhile, the rest of the files must not land on
 * that project's board (nor be counted, nor toasted there).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ gates: [] as (() => void)[], started: 0 }));

vi.mock('../../../lib/imageImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/imageImport')>()),
  importImageFile: () => {
    io.started++;
    return new Promise((resolve) => io.gates.push(() => resolve({ blob: new Blob(['i']), thumb: new Blob(['t']), width: 4, height: 4 })));
  },
  blobToImageData: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) }),
}));

import { useStore } from '../../../state/store';
import { addImageIdeas } from './ideas';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('addImageIdeas', () => {
  it('stops when another project opens mid-import', async () => {
    await useStore.getState().createProject('A');
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((n) => new File(['x'], n, { type: 'image/jpeg' }));
    const pending = addImageIdeas(files, []);
    await tick();
    io.gates.shift()!(); // first image imported into A
    while (io.started < 2) await tick(); // A got the first image; the second is importing
    expect(useStore.getState().project!.ideaBoard).toHaveLength(1);
    await useStore.getState().createProject('B');
    io.gates.shift()!(); // the second finishes after B opened
    expect(await pending).toBe(1);
    expect(useStore.getState().project!.name).toBe('B');
    expect(useStore.getState().project!.ideaBoard).toEqual([]);
    expect(io.started).toBe(2); // the third file was never imported
    expect(useStore.getState().toasts.some((t) => /idea board/.test(t.message))).toBe(false);
  });
});
