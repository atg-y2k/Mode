/**
 * (3) Fine-tune hand tools: add a Wall surface, outline it with the Polygon
 * tool, pick a paint color — the composited photo on the editor canvas
 * changes inside the outline and stays the same outside it.
 */
import type { Page } from '@playwright/test';
import { addSpaceWithPhoto, createProject, expect, panel, panelTab, ROOM, roomJpeg, shot, test } from './support';

/** A patch of the plain back wall (photo px), clear of the window and the sofa. */
const PATCH = { x0: 470, y0: 150, x1: 900, y1: 400 } as const;

test('Wall surface, polygon outline, paint color → the canvas changes', async ({ page }) => {
  await createProject(page, { name: 'Living room colors' });
  await addSpaceWithPhoto(page, { type: 'Living room', photo: await roomJpeg(page), fileName: 'Living.jpg' });
  await expect(page.locator('main img[alt$="— original"]')).toBeVisible();

  // Fine-tune mode: the canvas editor and the Surfaces panel.
  await page.getByRole('radio', { name: 'Fine-tune' }).click();
  const stage = page.getByTestId('editor-stage');
  await expect(stage).toBeVisible();
  await expect(panelTab(page, 'surfaces')).toHaveAttribute('aria-selected', 'true');
  const rect = await waitForPhotoOnCanvas(page);

  const inside = { x: (PATCH.x0 + PATCH.x1) / 2, y: (PATCH.y0 + PATCH.y1) / 2 };
  const floor = { x: 600, y: 760 };
  const wallOutside = { x: 350, y: 480 }; // the same wall, under the window: outside the outline
  const before = {
    inside: await canvasPixel(page, rect, inside),
    floor: await canvasPixel(page, rect, floor),
    wallOutside: await canvasPixel(page, rect, wallOutside),
  };

  // 1. Add a Wall surface.
  await panel(page).getByRole('button', { name: 'Add surface: Wall' }).click();
  await expect(panel(page).getByText(/In this photo · 1/)).toBeVisible();

  // 2. Outline it with the Polygon tool: four corners, then click the first one again to close.
  const polygon = page.getByRole('toolbar', { name: 'Editing tools' }).getByRole('button', { name: 'Polygon (P)' });
  await polygon.click();
  await expect(polygon).toHaveAttribute('aria-pressed', 'true');
  const corners = [
    [PATCH.x0, PATCH.y0],
    [PATCH.x1, PATCH.y0],
    [PATCH.x1, PATCH.y1],
    [PATCH.x0, PATCH.y1],
    [PATCH.x0, PATCH.y0],
  ] as const;
  for (const [x, y] of corners) {
    const p = toScreen(rect, x, y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(350); // not a double click
  }
  await expect(panel(page).getByText('Not outlined yet')).toBeHidden();
  await shot(page, 'finetune-1-outlined');

  // 3. Paint: pick a strong color from the fan deck.
  await panelTab(page, 'paint').click();
  const paint = panel(page);
  await expect(paint.getByRole('heading', { name: 'Color library' })).toBeVisible();
  const color = await chooseDarkSwatch(page);
  await expect(paint.getByText('No paint yet.')).toBeHidden();
  await shot(page, 'finetune-2-painted');

  // The canvas: the outlined patch shows the paint; the rest of the wall and the floor did not change.
  await expect.poll(async () => distance(await canvasPixel(page, rect, inside), before.inside), { message: 'wall pixel changed' }).toBeGreaterThan(60);
  expect(distance(await canvasPixel(page, rect, inside), color), 'the wall shows the chosen paint').toBeLessThan(40);
  expect(distance(await canvasPixel(page, rect, wallOutside), before.wallOutside)).toBeLessThan(6);
  expect(distance(await canvasPixel(page, rect, floor), before.floor)).toBeLessThan(6);
});

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The photo's rectangle on the editor's display canvas (page px), found from the drawn (non-transparent) pixels. */
async function waitForPhotoOnCanvas(page: Page): Promise<Rect> {
  let rect: Rect | null = null;
  await expect
    .poll(async () => {
      rect = await page.getByTestId('editor-stage').locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
        const g = c.getContext('2d');
        if (!g || !c.width || !c.height) return null;
        const { data } = g.getImageData(0, 0, c.width, c.height);
        let x0 = c.width;
        let y0 = c.height;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < c.height; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            if (data[(y * c.width + x) * 4 + 3] > 0) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return null;
        const box = c.getBoundingClientRect();
        const k = box.width / c.width;
        return { x: box.x + x0 * k, y: box.y + y0 * k, width: (x1 - x0 + 2) * k, height: (y1 - y0 + 2) * k };
      });
      return rect ? Math.round((rect.width / rect.height) * 100) : 0;
    }, { message: 'the photo drawn on the editor canvas' })
    .toBe(Math.round((ROOM.width / ROOM.height) * 100));
  return rect!;
}

function toScreen(rect: Rect, x: number, y: number) {
  return { x: rect.x + (x / ROOM.width) * rect.width, y: rect.y + (y / ROOM.height) * rect.height };
}

/** Mean RGB of a 5×5 block of the display canvas at a photo position. */
async function canvasPixel(page: Page, rect: Rect, at: { x: number; y: number }): Promise<[number, number, number]> {
  const p = toScreen(rect, at.x, at.y);
  return page.getByTestId('editor-stage').locator('canvas').first().evaluate((c: HTMLCanvasElement, p) => {
    const box = c.getBoundingClientRect();
    const k = c.width / box.width;
    const cx = Math.round((p.x - box.x) * k);
    const cy = Math.round((p.y - box.y) * k);
    const { data } = c.getContext('2d')!.getImageData(cx - 2, cy - 2, 5, 5);
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let ch = 0; ch < 3; ch++) sum[ch] += data[i + ch];
    return sum.map((v) => v / 25) as [number, number, number];
  }, p);
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Clicks the darkest swatch of the fan deck (a big change from the light wall); returns its RGB. */
async function chooseDarkSwatch(page: Page): Promise<[number, number, number]> {
  const swatches = panel(page).locator('[data-swatch]');
  await expect(swatches.first()).toBeVisible();
  const labels = await swatches.evaluateAll((els) =>
    els.map((el) => {
      const m = /#([0-9a-f]{6})/i.exec(el.getAttribute('aria-label') ?? '');
      const hex = m ? parseInt(m[1], 16) : 0xffffff;
      const lum = 0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);
      return { label: el.getAttribute('aria-label') ?? '', lum, rgb: [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255] as [number, number, number] };
    }),
  );
  labels.sort((a, b) => a.lum - b.lum);
  const pick = labels[0];
  await panel(page).getByRole('button', { name: pick.label, exact: true }).click();
  await expect(panel(page).getByRole('button', { name: pick.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  return pick.rgb;
}
