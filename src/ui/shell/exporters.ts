/**
 * Image exports for the Export menu:
 * - Studio: the image in the viewer (a variation, or the original photo),
 *   before/after of the shown variation, and a labeled sheet of a run
 *   (e.g. a compare run: "Front walk — stone size" in 4 options).
 * - Fine-tune: the composited design (renderDesignToBlob) and before/after
 *   (renderBeforeAfterBlob), both via loadRenderContext.
 * Everything runs in the browser; files are downloaded, nothing is uploaded.
 */
import type { Design, Generation, Photo, Project, Variation } from '../../../shared/types';
import { renderBeforeAfterBlob, renderDesignToBlob } from '../../engine/compositor';
import { downloadBlob } from '../../lib/imageImport';
import * as db from '../../state/persistence';
import { loadRenderContext } from '../../state/renderContext';
import { findVariation } from '../../state/store';
import { exportFileName } from './format';

export type BeforeAfterLayout = 'side-by-side' | 'stacked';

/** Long edge cap for composites (keeps files shareable). */
const MAX_EDGE = 1600;

function extFor(blob: Blob): string {
  if (blob.type === 'image/png') return 'png';
  if (blob.type === 'image/webp') return 'webp';
  return 'jpg';
}

async function requireBlob(id: string, what: string): Promise<Blob> {
  const blob = await db.getBlob(id);
  if (!blob) throw new Error(`The ${what} is missing from this device's storage.`);
  return blob;
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

/** Downloads the variation (or the original photo when `variation` is undefined). Returns the file name. */
export async function exportStudioImage(project: Project, photo: Photo, variation: Variation | undefined): Promise<string> {
  const blob = variation ? await requireBlob(variation.imageId, 'variation image') : await requireBlob(photo.imageId, 'photo');
  const name = exportFileName([project.name, photo.name, variation ? variation.title || 'variation' : 'original'], extFor(blob));
  downloadBlob(blob, name);
  return name;
}

export async function exportStudioBeforeAfter(
  project: Project,
  photo: Photo,
  variation: Variation,
  layout: BeforeAfterLayout,
): Promise<string> {
  const [beforeBlob, afterBlob] = await Promise.all([
    requireBlob(photo.imageId, 'photo'),
    requireBlob(variation.imageId, 'variation image'),
  ]);
  const [before, after] = await Promise.all([decode(beforeBlob), decode(afterBlob)]);
  try {
    const { w, h } = fitSize(photo.width || before.width, photo.height || before.height, MAX_EDGE);
    const gap = Math.max(4, Math.round(Math.min(w, h) * 0.012));
    const side = layout === 'side-by-side';
    const canvas = makeCanvas(side ? w * 2 + gap : w, side ? h : h * 2 + gap);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas is not available in this browser.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = 'high';
    drawCover(g, before, 0, 0, w, h);
    const ax = side ? w + gap : 0;
    const ay = side ? 0 : h + gap;
    drawCover(g, after, ax, ay, w, h);
    const fontPx = Math.max(14, Math.round(Math.min(w, h) * 0.034));
    drawPill(g, 'Before', Math.round(fontPx * 0.8), Math.round(fontPx * 0.8), fontPx);
    drawPill(g, 'After', ax + Math.round(fontPx * 0.8), ay + Math.round(fontPx * 0.8), fontPx);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const name = exportFileName([project.name, photo.name, variation.title || 'variation', 'before-after'], 'jpg');
    downloadBlob(blob, name);
    return name;
  } finally {
    closeImage(before);
    closeImage(after);
  }
}

/** Title for a run sheet: compare runs name the element and the question compared. */
export function generationSheetTitle(gen: Generation): string {
  if (gen.mode === 'compare' && gen.compare) {
    const el = gen.brief.elements.find((e) => e.id === gen.compare!.elementId);
    const dim = el?.dimensions.find((d) => d.id === gen.compare!.dimensionId);
    if (el && dim) return `${el.label} — ${dim.label}`;
    if (el) return `${el.label} — options compared`;
    return 'Options compared';
  }
  return `${gen.variations.length} variation${gen.variations.length === 1 ? '' : 's'}`;
}

/** Labeled grid of a run's variations, the original first. */
export async function exportGenerationSheet(project: Project, photo: Photo, gen: Generation): Promise<string> {
  const variations = gen.variations;
  if (!variations.length) throw new Error('This run has no finished images yet.');
  const base = findVariation(photo, gen.baseVariationId ?? null);
  const tiles: { label: string; imageId: string }[] = [
    { label: base ? `Start: ${base.title || 'variation'}` : 'Original', imageId: base ? base.imageId : photo.imageId },
    ...variations.map((v) => ({ label: v.optionLabel || v.title || 'Variation', imageId: v.imageId })),
  ];
  const images = await Promise.all(
    tiles.map(async (t) => {
      const blob = await db.getBlob(t.imageId);
      return blob ? decode(blob).catch(() => null) : null;
    }),
  );
  try {
    const count = tiles.length;
    const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    const tileW = Math.min(800, Math.max(320, Math.round(1800 / cols)));
    const tileH = Math.round((tileW * (photo.height || 3)) / (photo.width || 4));
    const pad = Math.round(tileW * 0.04);
    const captionH = Math.round(tileW * 0.085);
    const headerH = Math.round(tileW * 0.16);
    const width = cols * tileW + (cols + 1) * pad;
    const height = headerH + rows * (tileH + captionH) + (rows + 1) * pad;
    const canvas = makeCanvas(width, height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas is not available in this browser.');
    g.fillStyle = '#f6f4f0';
    g.fillRect(0, 0, width, height);

    // Header
    const titleFont = Math.round(headerH * 0.34);
    g.fillStyle = '#1f1d1a';
    g.textBaseline = 'alphabetic';
    g.font = `${titleFont}px ui-serif, Georgia, 'Times New Roman', serif`;
    g.fillText(ellipsize(g, generationSheetTitle(gen), width - pad * 2), pad, pad + titleFont);
    const subFont = Math.round(headerH * 0.17);
    g.font = `${subFont}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    g.fillStyle = '#6b665d';
    const sub = [project.name, photo.name, new Date(gen.createdAt).toLocaleDateString()].filter(Boolean).join(' · ');
    g.fillText(ellipsize(g, sub, width - pad * 2), pad, pad + titleFont + subFont * 1.6);

    // Tiles
    const capFont = Math.round(captionH * 0.42);
    tiles.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (tileW + pad);
      const y = headerH + pad + row * (tileH + captionH + pad);
      const img = images[i];
      if (img) drawCover(g, img, x, y, tileW, tileH);
      else {
        g.fillStyle = '#e8e3da';
        g.fillRect(x, y, tileW, tileH);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(x, y + tileH, tileW, captionH);
      g.fillStyle = i === 0 ? '#6b665d' : '#1f1d1a';
      g.font = `${i === 0 ? '' : '600 '}${capFont}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
      g.fillText(ellipsize(g, t.label, tileW - capFont * 1.6), x + capFont * 0.8, y + tileH + captionH / 2 + capFont * 0.36);
    });

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    const name = exportFileName([project.name, photo.name, generationSheetTitle(gen), 'sheet'], 'jpg');
    downloadBlob(blob, name);
    return name;
  } finally {
    images.forEach((im) => im && closeImage(im));
  }
}

// ---------------------------------------------------------------------------
// Fine-tune
// ---------------------------------------------------------------------------

export async function exportDesignImage(project: Project, photo: Photo, design: Design): Promise<string> {
  const ctx = await loadRenderContext(photo, design);
  const blob = await renderDesignToBlob(ctx, 'image/jpeg', 0.92);
  const name = exportFileName([project.name, photo.name, design.name], extFor(blob));
  downloadBlob(blob, name);
  return name;
}

export async function exportDesignBeforeAfter(
  project: Project,
  photo: Photo,
  design: Design,
  layout: BeforeAfterLayout,
): Promise<string> {
  const ctx = await loadRenderContext(photo, design);
  const blob = await renderBeforeAfterBlob(ctx, layout);
  const name = exportFileName([project.name, photo.name, design.name, 'before-after'], extFor(blob));
  downloadBlob(blob, name);
  return name;
}

/** Best layout for a photo: wide photos stack, tall / square ones sit side by side. */
export function preferredLayout(photo: Pick<Photo, 'width' | 'height'>): BeforeAfterLayout {
  return photo.width > photo.height * 1.15 ? 'stacked' : 'side-by-side';
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

type Drawable = ImageBitmap | HTMLImageElement;

async function decode(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through to <img> (older Safari with some formats)
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeImage(img: Drawable) {
  if ('close' in img && typeof img.close === 'function') img.close();
}

function fitSize(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Draws `img` covering the rect (center crop when aspect ratios differ). */
function drawCover(g: CanvasRenderingContext2D, img: Drawable, x: number, y: number, w: number, h: number) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function drawPill(g: CanvasRenderingContext2D, text: string, x: number, y: number, fontPx: number) {
  g.font = `600 ${fontPx}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  const padX = fontPx * 0.7;
  const h = fontPx * 1.8;
  const w = g.measureText(text).width + padX * 2;
  g.fillStyle = 'rgba(20, 19, 17, 0.62)';
  roundRect(g, x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'middle';
  g.fillText(text, x + padX, y + h / 2 + fontPx * 0.04);
  g.textBaseline = 'alphabetic';
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function ellipsize(g: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (g.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, quality);
  });
}
