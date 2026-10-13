/**
 * Cached photo-resolution overlay canvases for region masks: the tint and
 * outline of the selected region (incrementally updatable during brush
 * strokes) and one combined layer for every other region ("show all").
 * Rebuilt only when a mask version, color or the region set changes.
 */
import type { Region } from '../../../shared/types';
import { maskOutline, maskToOverlay } from '../../engine/mask';
import type { ImageDataLike, Mask } from '../../engine/types';
import type { IRect } from './geometry';

export const SELECTED_TINT_ALPHA = 0.4;
export const OTHER_TINT_ALPHA = 0.24;

type Canvas2D = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

function makeCanvas(width: number, height: number): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser');
  return { canvas, ctx };
}

/** ImageData view over engine pixels (no copy when the buffer allows it). */
export function asImageData(img: ImageDataLike): ImageData {
  if (img instanceof ImageData) return img;
  const d = img.data;
  if (d.buffer instanceof ArrayBuffer && d.length === img.width * img.height * 4) {
    return new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, d.length), img.width, img.height);
  }
  return new ImageData(new Uint8ClampedArray(d), img.width, img.height);
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x4dabf7;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface MaskEntry {
  region: Region;
  mask: Mask;
  version: number;
}

interface SelectedLayer {
  maskId: string;
  color: string;
  version: number;
  tint: Canvas2D;
  tintData: ImageData;
  outline: Canvas2D | null;
  outlineKey: string;
}

export class MaskLayers {
  private selected: SelectedLayer | null = null;
  private others: { key: string; layer: Canvas2D } | null = null;

  /** Tint of the selected region; rebuilt when its version or color changed. */
  selectedTint(region: Region, mask: Mask, version: number): HTMLCanvasElement {
    const L = this.ensureSelected(region, mask);
    if (L.version !== version || L.color !== region.color) {
      maskToOverlay(mask, region.color, SELECTED_TINT_ALPHA, L.tintData);
      L.tint.ctx.putImageData(L.tintData, 0, 0);
      L.version = version;
      L.color = region.color;
    }
    return L.tint.canvas;
  }

  /**
   * Refreshes only `rect` of the selected tint after an in-place mask edit
   * (brush strokes) — far cheaper than a full rebuild every frame.
   */
  updateSelectedRect(region: Region, mask: Mask, rect: IRect): void {
    const L = this.selected;
    if (!L || L.maskId !== region.maskId || L.version < 0) return;
    const [r, g, b] = hexRgb(L.color);
    const out = L.tintData.data;
    const md = mask.data;
    const w = mask.width;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      let i = y * w + rect.x;
      let o = i * 4;
      for (let x = 0; x < rect.w; x++, i++, o += 4) {
        const v = md[i];
        if (v === 0) {
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
          out[o + 3] = 0;
        } else {
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = Math.round(SELECTED_TINT_ALPHA * v);
        }
      }
    }
    L.tint.ctx.putImageData(L.tintData, 0, 0, rect.x, rect.y, rect.w, rect.h);
  }

  /** Mark the selected tint as current for `version` (after incremental updates). */
  syncSelectedVersion(maskId: string, version: number): void {
    if (this.selected && this.selected.maskId === maskId && this.selected.version >= 0) this.selected.version = version;
  }

  selectedOutline(region: Region, mask: Mask, version: number): HTMLCanvasElement {
    const L = this.ensureSelected(region, mask);
    const key = `${version}|${region.color}`;
    if (!L.outline || L.outlineKey !== key) {
      if (!L.outline) L.outline = makeCanvas(mask.width, mask.height);
      L.outline.ctx.putImageData(asImageData(maskOutline(mask, region.color)), 0, 0);
      L.outlineKey = key;
    }
    return L.outline.canvas;
  }

  /** One canvas with every given region's outline (and tint when `tint`). */
  othersLayer(entries: MaskEntry[], width: number, height: number, tint: boolean): HTMLCanvasElement | null {
    if (!entries.length) return null;
    const key = `${tint ? 't' : 'o'}|${width}x${height}|` + entries.map((e) => `${e.region.maskId}:${e.version}:${e.region.color}`).join('|');
    if (this.others?.key === key) return this.others.layer.canvas;
    const layer =
      this.others && this.others.layer.canvas.width === width && this.others.layer.canvas.height === height
        ? this.others.layer
        : makeCanvas(width, height);
    layer.ctx.clearRect(0, 0, width, height);
    const scratch = makeCanvas(width, height);
    const scratchData = scratch.ctx.createImageData(width, height);
    for (const e of entries) {
      if (e.mask.width !== width || e.mask.height !== height) continue;
      if (tint) {
        maskToOverlay(e.mask, e.region.color, OTHER_TINT_ALPHA, scratchData);
        scratch.ctx.putImageData(scratchData, 0, 0);
        layer.ctx.drawImage(scratch.canvas, 0, 0);
      }
      scratch.ctx.putImageData(asImageData(maskOutline(e.mask, e.region.color)), 0, 0);
      layer.ctx.drawImage(scratch.canvas, 0, 0);
    }
    // Free the scratch backing store right away (large on photos).
    scratch.canvas.width = 0;
    scratch.canvas.height = 0;
    this.others = { key, layer };
    return layer.canvas;
  }

  clear(): void {
    for (const c of [this.selected?.tint, this.selected?.outline, this.others?.layer]) {
      if (c) {
        c.canvas.width = 0;
        c.canvas.height = 0;
      }
    }
    this.selected = null;
    this.others = null;
  }

  private ensureSelected(region: Region, mask: Mask): SelectedLayer {
    const L = this.selected;
    if (L && L.maskId === region.maskId && L.tint.canvas.width === mask.width && L.tint.canvas.height === mask.height) return L;
    // Reuse the canvases when only the region changed (same photo size).
    const sameSize = L && L.tint.canvas.width === mask.width && L.tint.canvas.height === mask.height;
    const tint = sameSize ? L!.tint : makeCanvas(mask.width, mask.height);
    const tintData = sameSize ? L!.tintData : tint.ctx.createImageData(mask.width, mask.height);
    const outline = sameSize ? L!.outline : null;
    this.selected = { maskId: region.maskId, color: region.color, version: -1, tint, tintData, outline, outlineKey: '' };
    return this.selected;
  }
}
