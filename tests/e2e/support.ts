/**
 * Shared e2e fixtures and helpers.
 *
 * - Hermetic network: only the app itself (Vite + the keyless Mode API) is
 *   reachable. chatgpt.com / gemini.google.com answer with a local stub page
 *   (Mode only opens a tab there; it never automates those sites) and every
 *   other outside request is refused — no vision model downloads, no NOAA /
 *   USDA lookups.
 * - Synthetic photos are drawn in the page with a canvas (a textured house
 *   front, a plain living room) and handed to the real file inputs.
 * - Uncaught page errors fail the test.
 */
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

export { expect };

export const test = base.extend<{ pageErrors: string[]; keylessApi: void }>({
  context: async ({ context }, use) => {
    await isolateNetwork(context);
    await use(context);
  },
  // The flows assume the keyless server (template plans, hand-off only). A reused dev server with
  // keys would call Claude / image APIs: refuse to run against it rather than spend money.
  keylessApi: [
    async ({ request }, use) => {
      const res = await request.get('/api/health');
      expect(res.ok(), 'the Mode API answers through the app (/api/health) — is the API server running behind Vite?').toBe(true);
      const health = (await res.json()) as { ai?: { enabled?: boolean }; imageProviders?: unknown[] };
      expect(
        { ai: !!health.ai?.enabled, imageProviders: health.imageProviders?.length ?? 0 },
        'e2e needs the keyless Mode API (MODE_AI=off, no image keys): stop a dev server that reuses the e2e ports, or set E2E_PORT / E2E_API_PORT',
      ).toEqual({ ai: false, imageProviders: 0 });
      await use();
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

async function isolateNetwork(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname) && url.protocol.startsWith('http'),
    (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'chatgpt.com' || host === 'gemini.google.com') {
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${host} (stub)</title><h1>${host} stub</h1>` });
      }
      return route.abort('blockedbyclient');
    },
  );
  // Frost dates & soil come from NOAA / USDA through the server: optional, and
  // never part of these flows — answer "unavailable" without going out.
  await context.route('**/api/site/profile**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'offline in e2e' } }) }),
  );
}

// ---------------------------------------------------------------------------
// Synthetic photos (drawn in the page, returned as JPEG bytes)
// ---------------------------------------------------------------------------

export const HOUSE = { width: 1200, height: 900 } as const;

/**
 * A textured house front (sky, trees, siding, shingles, windows, red door,
 * foundation beds, a concrete walk to the door, lawn, grain) — enough
 * structure for feature matching when a "returned" image is lined up.
 */
export async function houseJpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ W, H }) => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const sky = g.createLinearGradient(0, 0, 0, 420);
    sky.addColorStop(0, '#7fb2e5');
    sky.addColorStop(1, '#cfe3f3');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, 440);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.4})`;
      const x = rnd() * W;
      const y = 40 + rnd() * 160;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        g.ellipse(x + k * 22, y + (k % 2) * 8, 34, 18, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `hsl(${100 + rnd() * 30}, 35%, ${22 + rnd() * 14}%)`;
      g.beginPath();
      g.ellipse(rnd() * W, 380 + rnd() * 40, 50 + rnd() * 50, 70 + rnd() * 40, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#5f8f3a';
    g.fillRect(0, 440, W, 460);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `hsl(${85 + rnd() * 25}, ${35 + rnd() * 25}%, ${25 + rnd() * 25}%)`;
      g.fillRect(rnd() * W, 440 + rnd() * 460, 2, 4 + rnd() * 4);
    }
    g.fillStyle = '#d9cbb4';
    g.fillRect(250, 255, 700, 305);
    g.strokeStyle = 'rgba(90,70,50,0.35)';
    for (let y = 262; y < 560; y += 9) {
      g.beginPath();
      g.moveTo(250, y);
      g.lineTo(950, y);
      g.stroke();
    }
    g.fillStyle = '#4a4a52';
    g.beginPath();
    g.moveTo(220, 262);
    g.lineTo(600, 110);
    g.lineTo(980, 262);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let y = 130; y < 262; y += 10) {
      const half = ((y - 110) / 152) * 380;
      for (let x = 600 - half; x < 600 + half; x += 18 + (y % 20 === 0 ? 5 : 0)) g.strokeRect(x, y, 18, 10);
    }
    const win = (x: number, y: number, w: number, h: number) => {
      g.fillStyle = '#fff';
      g.fillRect(x - 6, y - 6, w + 12, h + 12);
      g.fillStyle = '#2f3d4c';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x + w / 2, y);
      g.lineTo(x + w / 2, y + h);
      g.moveTo(x, y + h / 2);
      g.lineTo(x + w, y + h / 2);
      g.stroke();
      g.lineWidth = 1;
      g.fillStyle = '#3c5a3a';
      g.fillRect(x - 26, y - 6, 16, h + 12);
      g.fillRect(x + w + 10, y - 6, 16, h + 12);
    };
    win(320, 300, 90, 110);
    win(470, 300, 70, 110);
    win(660, 300, 70, 110);
    win(790, 300, 90, 110);
    win(320, 440, 90, 90);
    win(790, 440, 90, 90);
    g.fillStyle = '#fff';
    g.fillRect(556, 402, 88, 158);
    g.fillStyle = '#8c2f2a';
    g.fillRect(565, 410, 70, 150);
    g.fillStyle = '#d9b44a';
    g.beginPath();
    g.arc(625, 490, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9a958c';
    g.fillRect(545, 560, 110, 25);
    g.fillStyle = '#4a3527';
    g.fillRect(250, 540, 290, 70);
    g.fillRect(660, 540, 290, 70);
    for (let i = 0; i < 14; i++) {
      const x = i < 7 ? 270 + i * 40 : 680 + (i - 7) * 40;
      g.fillStyle = `hsl(${110 + rnd() * 20}, 40%, ${26 + rnd() * 10}%)`;
      g.beginPath();
      g.ellipse(x, 548, 24, 20, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#b9b3a8';
    g.beginPath();
    g.moveTo(565, 585);
    g.lineTo(635, 585);
    g.lineTo(700, 900);
    g.lineTo(500, 900);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(80,75,70,0.5)';
    for (let y = 620; y < 900; y += 55) {
      const t = (y - 585) / 315;
      g.beginPath();
      g.moveTo(565 - 65 * t, y);
      g.lineTo(635 + 65 * t, y);
      g.stroke();
    }
    g.fillStyle = '#222';
    g.fillRect(140, 640, 8, 120);
    g.fillRect(118, 618, 52, 28);
    g.fillRect(1030, 600, 6, 170);
    g.fillStyle = '#f4e3a1';
    g.fillRect(1020, 585, 26, 22);
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { W: HOUSE.width, H: HOUSE.height });
  return Buffer.from(b64, 'base64');
}

export const ROOM = { width: 1200, height: 900 } as const;
/** The plain back wall of the synthetic living room, in photo pixels. */
export const ROOM_WALL = { x0: 220, y0: 120, x1: 980, y1: 560 } as const;

/** A simple living room: a light back wall with a window, side walls, ceiling, a plank floor and a sofa. */
export async function roomJpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async ({ W, H, wall }) => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    // ceiling, side walls, back wall
    g.fillStyle = '#efece6';
    g.fillRect(0, 0, W, wall.y0);
    g.fillStyle = '#d8d0c2';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(wall.x0, wall.y0);
    g.lineTo(wall.x0, wall.y1);
    g.lineTo(0, H);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(W, 0);
    g.lineTo(wall.x1, wall.y0);
    g.lineTo(wall.x1, wall.y1);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    const back = g.createLinearGradient(wall.x0, 0, wall.x1, 0);
    back.addColorStop(0, '#e2dccf');
    back.addColorStop(1, '#ebe6db');
    g.fillStyle = back;
    g.fillRect(wall.x0, wall.y0, wall.x1 - wall.x0, wall.y1 - wall.y0);
    // window on the back wall (left part, so the wall's middle stays plain)
    g.fillStyle = '#fafafa';
    g.fillRect(270, 180, 170, 220);
    g.fillStyle = '#9cc3e6';
    g.fillRect(282, 192, 146, 196);
    // floor planks
    g.fillStyle = '#a0764c';
    g.beginPath();
    g.moveTo(wall.x0, wall.y1);
    g.lineTo(wall.x1, wall.y1);
    g.lineTo(W, H);
    g.lineTo(0, H);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(60,35,15,0.35)';
    for (let i = -8; i <= 8; i++) {
      g.beginPath();
      g.moveTo(600 + i * 48, wall.y1);
      g.lineTo(600 + i * 120, H);
      g.stroke();
    }
    // baseboard
    g.fillStyle = '#f7f5f0';
    g.fillRect(wall.x0, wall.y1 - 14, wall.x1 - wall.x0, 14);
    // sofa in front of the right part of the wall
    g.fillStyle = '#4d5d6e';
    g.fillRect(640, 430, 300, 110);
    g.fillRect(620, 470, 340, 120);
    // grain
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 6;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { W: ROOM.width, H: ROOM.height, wall: ROOM_WALL });
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------------------
// App flows
// ---------------------------------------------------------------------------

/** Projects home → "Start a project" → name (+ ZIP) → the project's workspace. */
export async function createProject(page: Page, opts: { name: string; zip?: string; zone?: string }): Promise<void> {
  await page.goto('/');
  // The hero's button (the empty projects list offers a second one).
  await page.getByRole('button', { name: 'Start a project' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'New project' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Project name').fill(opts.name);
  if (opts.zip) {
    await dialog.getByLabel(/ZIP code/).fill(opts.zip);
    if (opts.zone) await expect(dialog.getByText(`USDA zone ${opts.zone}`, { exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  // The workspace of the new project (its name is the document title).
  await expect(page).toHaveTitle(`${opts.name} · Mode`);
}

/**
 * "Add a space" (type tile) → "Add & choose photos" → the photo goes through
 * the real file chooser. Starts from the empty workspace ("More space types").
 */
export async function addSpaceWithPhoto(page: Page, opts: { type: string; photo: Buffer; fileName: string }): Promise<void> {
  await page.getByRole('button', { name: /More space types/ }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Add a space' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${opts.type}`) }).click();
  await expect(dialog.getByRole('radio', { name: new RegExp(`^${opts.type}`) })).toHaveAttribute('aria-checked', 'true');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Add & choose photos' }).click();
  await (await chooser).setFiles({ name: opts.fileName, mimeType: 'image/jpeg', buffer: opts.photo });
  await expect(dialog).toBeHidden();
}

/** The original photo in the Studio viewer, once decoded and laid out. */
export function studioPhoto(page: Page) {
  return page.locator('main img[alt$="— original"]');
}

/** Screen position of a photo pixel in the Studio viewer. */
export async function photoToScreen(page: Page, photo: { width: number; height: number }, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await studioPhoto(page).boundingBox();
  if (!box) throw new Error('the photo is not on screen');
  return { x: box.x + (x / photo.width) * box.width, y: box.y + (y / photo.height) * box.height };
}

/** A panel tab of the workspace's right panel (Design, Scene… / Surfaces, Paint…). */
export function panelTab(page: Page, id: string) {
  return page.locator(`[role="tab"][data-tab="${id}"]`);
}

/** The workspace's right panel content. */
export function panel(page: Page) {
  return page.locator('#workspace-panel');
}

/** The prompt dock's Generate button ("Generate" or "Generate 3"). */
export function dockGenerate(page: Page) {
  return page.getByRole('button', { name: /^Generate( \d)?$/ });
}

/** Debug screenshots: written to $E2E_SHOTS/<name>.png when that variable is set (no-op otherwise). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}
