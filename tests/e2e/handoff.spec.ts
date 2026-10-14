/**
 * (2) The hand-off loop, end to end with the keyless server (template plan):
 * compose a Pathway brief on an outlined area → Generate (hand-off to
 * ChatGPT, the default) → review the plan → companion: "Copy photo & open
 * ChatGPT" puts the PNG on the clipboard and opens one chatgpt.com tab with
 * ?prompt= (a local stub — Mode never automates the site) → bring back a
 * "returned" image (the clean export, rescaled, slightly cropped, colour cast,
 * new stones inside the outline) through the file picker → staging (lined
 * up, outside protected) → Accept → a variation tile marked as ChatGPT.
 * Halfway, the page reloads (as when the browser drops the tab while the
 * owner is in ChatGPT): Mode reopens the project with the hand-off waiting.
 */
import type { Page } from '@playwright/test';
import { addSpaceWithPhoto, createProject, dockGenerate, expect, HOUSE, houseJpeg, panel, photoToScreen, shot, studioPhoto, test } from './support';

/** The walk to the door, as a rectangle in photo pixels (≈7% of the frame → a close-up crop is exported). */
const WALK = { x0: 470, y0: 600, x1: 730, y1: 880 } as const;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('Pathway brief → hand-off to ChatGPT → import → staging → accept', async ({ page, context }) => {
  await createProject(page, { name: 'Hand-off house', zip: '20817', zone: '7b' });
  await addSpaceWithPhoto(page, { type: 'Front yard', photo: await houseJpeg(page), fileName: 'Front.jpg' });
  await expect(studioPhoto(page)).toBeVisible();
  await expect.poll(() => studioPhoto(page).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(HOUSE.width);

  // --- Compose: outline the walk on the photo (the area that may change)…
  await page.getByRole('button', { name: 'Outline an area to change' }).click();
  for (const [x, y] of [
    [WALK.x0, WALK.y0],
    [WALK.x1, WALK.y0],
    [WALK.x1, WALK.y1],
    [WALK.x0, WALK.y1],
  ] as const) {
    const p = await photoToScreen(page, HOUSE, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('Sketched area added to the areas that may change.')).toBeVisible();

  // …add a Pathway element and answer two of its visual questions.
  const design = panel(page);
  await design.getByRole('button', { name: 'Pathway', exact: true }).click();
  const card = design.locator('[data-element-id]').filter({ hasText: 'Pathway' });
  await expect(card.getByRole('heading', { name: 'What stone and color should the path be?' })).toBeVisible();
  await card.getByRole('radio', { name: /^Gray granite/ }).click();
  await expect(card.getByRole('radio', { name: /^Gray granite/ })).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('radio', { name: /^Large flagstone slabs/ }).click();
  await expect(card.getByRole('radio', { name: /^Large flagstone slabs/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('textbox', { name: 'Describe the change', exact: true }).fill('A wider flagstone walk to the front door');

  // Hand-off to ChatGPT is the default way variations are rendered; one variation for this run.
  await expect(page.getByRole('radio', { name: 'ChatGPT' })).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'handoff-1-brief');
  await page.getByLabel('Variations per run').selectOption('1');

  // --- Generate → review (the server's template plan; no AI key needed).
  await dockGenerate(page).click();
  const review = page.getByRole('dialog').filter({ hasText: 'Review before handing off to ChatGPT' });
  await expect(review).toBeVisible();
  await expect(review.getByRole('textbox', { name: 'Instruction for variation 1' })).toBeVisible({ timeout: 30_000 });
  await expect(review.getByRole('img', { name: /The marked photo you'll paste into ChatGPT/ })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'handoff-2-review');
  const send = review.getByRole('button', { name: 'Send to ChatGPT' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(review).toBeHidden();

  // --- Companion: copy the marked photo and open ChatGPT (a stub tab).
  const companion = page.getByRole('dialog', { name: 'Hand-off companion' });
  await expect(companion).toBeVisible();

  // A reload (or a discarded tab) while the owner is off in ChatGPT: the project reopens, not the projects home,
  // and the hand-off is still waiting. (Reloaded once the run is saved — seconds pass before anyone switches tabs.)
  await expect(companion.getByRole('button', { name: /Copy photo & open ChatGPT/ })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText('Saving…')).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveTitle('Hand-off house · Mode');
  await expect(studioPhoto(page)).toBeVisible();
  await expect(page.locator('main').getByText('Original photo', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your projects' })).toHaveCount(0);
  const pill = page.getByRole('button', { name: '1 hand-off waiting — open the hand-off card' });
  await expect(pill.or(companion.getByText('1 waiting', { exact: false })).first()).toBeVisible();
  await shot(page, 'handoff-3a-after-reload');
  if (!(await companion.isVisible())) await pill.click();
  await expect(companion).toBeVisible();
  const copyAndOpen = companion.getByRole('button', { name: /Copy photo & open ChatGPT/ });
  await expect(copyAndOpen).toBeEnabled({ timeout: 30_000 });
  await shot(page, 'handoff-3-companion');
  const popupPromise = context.waitForEvent('page');
  await copyAndOpen.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toMatch(/^https:\/\/chatgpt\.com\/\?.*prompt=/);
  expect(context.pages(), 'exactly one ChatGPT tab').toHaveLength(2);
  const prompt = new URL(popup.url()).searchParams.get('prompt') ?? '';
  expect(prompt).toContain('Edit the attached photo');
  await popup.close();
  await page.bringToFront();
  const marked = await clipboardImage(page);
  expect(marked.type).toBe('image/png');

  // The clean export (same frame, no outline).
  await companion.getByRole('button', { name: 'Clean photo' }).click();
  const clean = await clipboardImage(page, marked.b64);
  expect(clean.width).toBe(marked.width);
  expect(clean.height).toBe(marked.height);

  // --- The "returned" image: made from the clean export, imported with the file picker.
  const returned = await fakeReturnedImage(page, clean.b64, marked.b64);
  const chooser = page.waitForEvent('filechooser');
  await companion.getByRole('button', { name: 'File…' }).click();
  await (await chooser).setFiles({ name: 'ChatGPT Image.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(returned, 'base64') });

  // --- Staging: lined up with the photo, Accept.
  const accept = page.getByRole('button', { name: 'Accept', exact: true });
  await expect(accept).toBeVisible({ timeout: 60_000 });
  const staging = page.locator('main');
  await expect(staging.getByText('Back from ChatGPT', { exact: false })).toBeVisible();
  await expect(staging.getByText('Aligned', { exact: true })).toBeVisible();
  // Plain words on screen; the measurements only in the line's tooltip.
  const lined = staging.locator('p').filter({ hasText: 'Lined up with your photo' });
  await expect(lined).toBeVisible();
  await expect(lined).toHaveAttribute('title', /Lined up within [\d.]+ px/);
  await shot(page, 'handoff-4-staging');
  await accept.click();
  await expect(accept).toBeHidden();

  // --- The new variation: a tile with ChatGPT provenance, shown in the viewer.
  const tile = page.getByRole('button', { name: /— / }).filter({ has: page.getByLabel('ChatGPT · Aligned') });
  await expect(tile).toHaveCount(1);
  await expect(tile.getByText('GPT', { exact: true })).toBeVisible();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Esc for original', { exact: false })).toBeVisible();
  await shot(page, 'handoff-5-accepted');
});

/** Reads the image on the clipboard (waits until it differs from `previous`). */
async function clipboardImage(page: Page, previous?: string): Promise<{ type: string; b64: string; width: number; height: number }> {
  let out: { type: string; b64: string; width: number; height: number } | null = null;
  await expect
    .poll(
      async () => {
        out = await page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          const item = items[0];
          const type = item?.types.find((t) => t.startsWith('image/'));
          if (!item || !type) return null;
          const blob = await item.getType(type);
          const bmp = await createImageBitmap(blob);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { type, b64: btoa(bin), width: bmp.width, height: bmp.height };
        });
        return out && out.b64 !== previous ? out.type : null;
      },
      { message: 'an image on the clipboard' },
    )
    .toMatch(/^image\//);
  return out!;
}

/**
 * What ChatGPT might send back: the clean export at 80 %, cropped 3 % at the
 * top-left, with a warm colour cast and new flagstones inside the outlined
 * area (found as the pixels where the marked copy differs from the clean one).
 */
async function fakeReturnedImage(page: Page, cleanB64: string, markedB64: string): Promise<string> {
  return page.evaluate(
    async ({ cleanB64, markedB64 }) => {
      const decode = async (b64: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [clean, marked] = await Promise.all([decode(cleanB64), decode(markedB64)]);
      const W = clean.width;
      const H = clean.height;
      const read = (bmp: ImageBitmap) => {
        const c = new OffscreenCanvas(W, H);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, W, H).data;
      };
      const a = read(clean);
      const b = read(marked);
      // Bounding box of the outline.
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) throw new Error('no outline found in the marked photo');
      // Stay well inside the outline (it is drawn just outside the area).
      const inset = 0.12;
      const box = { x: x0 + (x1 - x0) * inset, y: y0 + (y1 - y0) * inset, w: (x1 - x0) * (1 - 2 * inset), h: (y1 - y0) * (1 - 2 * inset) };

      // Edit at export size: flagstones in the box.
      const edit = new OffscreenCanvas(W, H);
      const e = edit.getContext('2d')!;
      e.drawImage(clean, 0, 0);
      e.fillStyle = '#6e6a63';
      e.fillRect(box.x, box.y, box.w, box.h);
      let seed = 3;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      e.save();
      e.beginPath();
      e.rect(box.x, box.y, box.w, box.h);
      e.clip();
      for (let i = 0; i < 220; i++) {
        e.fillStyle = `hsl(${30 + rnd() * 20}, ${8 + rnd() * 10}%, ${52 + rnd() * 20}%)`;
        e.beginPath();
        e.ellipse(box.x + rnd() * box.w, box.y + rnd() * box.h, (0.04 + rnd() * 0.05) * box.w, (0.03 + rnd() * 0.04) * box.h, rnd() * 3, 0, Math.PI * 2);
        e.fill();
      }
      e.restore();

      // Rescale to 80 %, crop 3 % top-left, warm cast.
      const sw = Math.round(W * 0.8);
      const sh = Math.round(H * 0.8);
      const out = new OffscreenCanvas(Math.round(sw * 0.97), Math.round(sh * 0.97));
      const o = out.getContext('2d')!;
      o.drawImage(edit, -sw * 0.03, -sh * 0.03, sw, sh);
      const img = o.getImageData(0, 0, out.width, out.height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = img.data[i] * 1.06 + 5;
        img.data[i + 2] = img.data[i + 2] * 0.92;
      }
      o.putImageData(img, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { cleanB64, markedB64 },
  );
}
