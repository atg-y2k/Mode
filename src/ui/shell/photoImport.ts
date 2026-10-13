/**
 * Adds photo files to a space with friendly feedback (non-images skipped,
 * per-file errors reported by the store). Scene mapping starts automatically
 * (see ./sceneJobs).
 */
import type { DragEvent } from 'react';
import { useStore } from '../../state/store';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
}

export function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Returns the ids of the photos added. */
export async function importPhotosToSpace(spaceId: string, files: File[]): Promise<string[]> {
  const s = useStore.getState();
  if (!files.length) return [];
  const images = files.filter(isImageFile);
  if (!images.length) {
    s.notify('Those files aren’t photos — choose JPEG, PNG, WebP or HEIC images.', 'error');
    return [];
  }
  const skipped = files.length - images.length;
  if (skipped) s.notify(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'isn’t an image' : 'aren’t images'}.`, 'info');
  const ids = await s.addPhotos(spaceId, images);
  if (ids.length) {
    const ai = !!useStore.getState().health?.ai.enabled;
    const what = ids.length === 1 ? 'Photo added' : `${ids.length} photos added`;
    s.notify(ai ? `${what} — mapping the scene in the background…` : `${what}.`, 'success');
  }
  return ids;
}

// ---------------------------------------------------------------------------
// One shared, always-mounted file input (see <PhotoPicker/>), so a picker can
// be opened from a modal that closes right away (e.g. "Add & choose photos").
// ---------------------------------------------------------------------------

let pickerInput: HTMLInputElement | null = null;
let pickerTarget: string | null = null;

export function registerPhotoPicker(el: HTMLInputElement | null): void {
  pickerInput = el;
}

/** Opens the system photo picker for a space. Must be called from a user gesture (click). */
export function pickPhotos(spaceId: string): void {
  if (!pickerInput) return;
  pickerTarget = spaceId;
  pickerInput.value = '';
  pickerInput.click();
}

export function takePickerTarget(): string | null {
  const t = pickerTarget;
  pickerTarget = null;
  return t;
}
