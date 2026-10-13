/**
 * Idea board operations: inspiration images (downscaled ≤ 1024 px + thumb,
 * 5 dominant colors, AI description when available), notes, design themes
 * and real products (search results or pasted links, with their image).
 */
import type { ProductResult } from '../../../../shared/api';
import type { DesignTheme, IdeaItem } from '../../../../shared/types';
import { isAbortError } from '../../../lib/api';
import { blobToImageData, importImageFile } from '../../../lib/imageImport';
import { fetchProductImage, productFromUrl } from '../../../lib/products';
import { describeIdea } from '../../../lib/studio';
import * as db from '../../../state/persistence';
import { useStore } from '../../../state/store';
import { errorText } from '../../shell/format';
import { isImageFile } from '../../shell/photoImport';
import { aiAvailability, aiUsable } from './aiErrors';
import { runAiJob } from './aiJobs';
import { extractPalette } from './colors';
import { productInfoFrom } from './productInfo';

const IDEA_IMAGE_MAX = 1024;
const state = () => useStore.getState();

/** Titles Mode gave items itself (file names…), which the AI may replace with a better one. */
const autoTitles = new Map<string, string>();

function findIdea(id: string): IdeaItem | undefined {
  return state().project?.ideaBoard.find((i) => i.id === id);
}

/** "IMG_2041-final copy.jpeg" → "IMG 2041 final copy". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Inspiration image';
}

async function paletteOf(blob: Blob): Promise<string[]> {
  try {
    return extractPalette(await blobToImageData(blob), 5);
  } catch {
    return [];
  }
}

export const describeJobKey = (id: string) => `describe:${id}`;

/** AI description (and a better title when Mode picked the current one) for an image idea. */
export function describeIdeaItem(id: string): void {
  void runAiJob(
    describeJobKey(id),
    async (signal) => {
      const item = findIdea(id);
      if (!item?.imageId) throw new Error('This idea has no image to describe.');
      const blob = await db.getBlob(item.imageId);
      if (!blob) throw new Error('The image is missing from storage.');
      const result = await describeIdea(blob, item.note || null, signal);
      if (signal.aborted) return result;
      const current = findIdea(id);
      if (!current) return result;
      const tags = result.styleTags.filter((t) => t.trim()).slice(0, 6);
      const patch: Partial<IdeaItem> = { aiDescription: `${result.description.trim()}${tags.length ? ` Style: ${tags.join(', ')}.` : ''}` };
      if (!current.title.trim() || current.title === autoTitles.get(id)) patch.title = result.title.trim() || current.title;
      state().updateIdeaItem(id, patch, { history: false });
      autoTitles.delete(id);
      return result;
    },
    { label: 'Reading the image…', what: 'describe this image' },
  );
}

/** Adds inspiration images (each downscaled, with a thumb and its colors); describes them with AI when it is on. */
export async function addImageIdeas(files: File[], spaceIds: string[]): Promise<number> {
  let added = 0;
  // Imports are slow: stop (instead of filling another project) when the user opens a different one meanwhile.
  const pid = state().project?.id;
  const images = files.filter(isImageFile);
  if (images.length < files.length) state().notify('Only image files can go on the idea board.', 'info');
  for (const file of images) {
    if (state().project?.id !== pid) break;
    try {
      const imported = await importImageFile(file, { maxSize: IDEA_IMAGE_MAX });
      if (state().project?.id !== pid) break;
      const colors = await paletteOf(imported.thumb);
      const title = titleFromFileName(file.name);
      const id = await state().addIdeaItem({ kind: 'image', title, note: '', colors, spaceIds, active: true }, { image: imported.blob, thumb: imported.thumb });
      if (!id) {
        if (state().project?.id !== pid) break;
        continue;
      }
      added++;
      autoTitles.set(id, title);
      if (aiUsable(aiAvailability(state().health))) describeIdeaItem(id);
    } catch (err) {
      state().notify(`${file.name}: ${errorText(err)}`, 'error');
    }
  }
  if (added > 0 && state().project?.id === pid) state().notify(added === 1 ? 'Added to your idea board.' : `${added} images added to your idea board.`, 'success');
  return added;
}

export async function addNoteIdea(title: string, note: string, spaceIds: string[]): Promise<string | null> {
  const t = title.trim();
  const n = note.trim();
  if (!t && !n) return null;
  return state().addIdeaItem({ kind: 'note', title: t || n.split(/[.\n]/)[0].slice(0, 60), note: n, colors: [], spaceIds, active: true });
}

export async function addThemeIdea(theme: DesignTheme, spaceIds: string[]): Promise<string | null> {
  const id = await state().addIdeaItem({
    kind: 'theme',
    themeId: theme.id,
    title: theme.name,
    note: '',
    colors: theme.palette.slice(0, 6),
    spaceIds,
    active: true,
  });
  if (id) state().notify(`“${theme.name}” added to your idea board.`, 'success');
  return id;
}

/**
 * Adds a store product: its image (downloaded through the server, downscaled,
 * colors extracted) when it has one, store / price / link / specs and its
 * description. Image problems don't block adding it.
 */
export async function addProductIdea(product: ProductResult, spaceIds: string[], signal?: AbortSignal): Promise<string | null> {
  const pid = state().project?.id;
  let blobs: { image: Blob; thumb: Blob } | undefined;
  let colors: string[] = [];
  if (product.imageUrl) {
    try {
      const raw = await fetchProductImage(product.imageUrl, signal);
      const imported = await importImageFile(raw, { maxSize: IDEA_IMAGE_MAX });
      blobs = { image: imported.blob, thumb: imported.thumb };
      colors = await paletteOf(imported.thumb);
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return null;
      // Keep the product without a picture.
    }
  }
  // Another project opened while the image downloaded: the product was meant for the previous one.
  if (signal?.aborted || state().project?.id !== pid) return null;
  const item: Omit<IdeaItem, 'id' | 'createdAt'> = {
    kind: 'product',
    title: product.name.trim() || 'Store product',
    note: '',
    colors,
    product: productInfoFrom(product),
    spaceIds,
    active: true,
  };
  const description = product.description.trim();
  if (description) item.aiDescription = description;
  return state().addIdeaItem(item, blobs);
}

export const PRODUCT_LINK_JOB = 'product-link';

/** Reads a pasted product page and adds the product to the idea board. Resolves true when added. */
export async function importProductLink(url: string, spaceIds: string[]): Promise<boolean> {
  const id = await runAiJob(
    PRODUCT_LINK_JOB,
    async (signal) => {
      const { product, method } = await productFromUrl(url, signal);
      const added = await addProductIdea(product, spaceIds, signal);
      if (signal.aborted || !added) return null;
      state().notify(
        method === 'partial'
          ? `Added “${product.name || 'the product'}” — some details couldn't be read from that page, so check its title and price.`
          : `Added “${product.name}” to your idea board.`,
        method === 'partial' ? 'info' : 'success',
      );
      return added;
    },
    { label: 'Reading the product page…', what: 'read that product page' },
  );
  return !!id;
}
