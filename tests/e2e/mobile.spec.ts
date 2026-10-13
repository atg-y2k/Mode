/**
 * (5) Phone smoke test (390 px wide, touch): a project with a photo, then
 * every pane of the workspace — Spaces, the photo, each Studio panel tab, and
 * the Fine-tune canvas and tool panels — fits the screen: nothing sticks out
 * sideways unless it sits in its own scrolling strip.
 */
import type { Page } from '@playwright/test';
import { addSpaceWithPhoto, createProject, expect, houseJpeg, panel, panelTab, shot, studioPhoto, test } from './support';

/**
 * Visible elements that reach past the left/right edge of the screen without
 * an ancestor that clips or scrolls them (a horizontal tab strip is fine; a
 * card pushing the layout wider is not). Also the page itself must not scroll
 * sideways.
 */
async function layoutOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out: string[] = [];
    if (document.scrollingElement && document.scrollingElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.scrollingElement.scrollWidth}px`);
    // Inside a horizontal scroller that itself fits the screen (a tab strip, the tool palette): fine.
    // Cut off by an overflow-hidden box is not — the workspace root clips everything.
    const scrolled = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'auto' && ox !== 'scroll') continue;
        const r = p.getBoundingClientRect();
        if (r.left >= -1 && r.right <= vw + 1) return true;
      }
      return false;
    };
    // HTML elements and whole icons (not the shapes inside an SVG, which the SVG clips).
    const boxes = Array.from(document.body.querySelectorAll('*')).filter((el) => el instanceof HTMLElement || el instanceof SVGSVGElement);
    for (const el of boxes) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (scrolled(el)) continue;
      const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40);
      out.push(`<${el.tagName.toLowerCase()}> "${name}" spans ${Math.round(r.left)}–${Math.round(r.right)}px`);
    }
    return out.slice(0, 10);
  });
}

async function expectFits(page: Page, where: string): Promise<void> {
  await shot(page, `mobile-${where}`);
  expect(await layoutOverflow(page), `${where}: layout fits 390 px`).toEqual([]);
}

function nav(page: Page) {
  return page.getByRole('navigation', { name: 'Workspace' });
}

test('phone: every workspace pane fits the screen', async ({ page }) => {
  expect(page.viewportSize()?.width).toBe(390);
  await page.goto('/');
  await expectFits(page, 'home');

  await createProject(page, { name: 'Phone house', zip: '20817', zone: '7b' });
  await expect(nav(page)).toBeVisible();
  await addSpaceWithPhoto(page, { type: 'Front of house', photo: await houseJpeg(page), fileName: 'Front.jpg' });

  // Photo pane (the Studio viewer + prompt dock).
  await expect(nav(page).getByRole('button', { name: 'Photo' })).toHaveAttribute('aria-current', 'page');
  await expect(studioPhoto(page)).toBeVisible();
  const photoBox = await studioPhoto(page).boundingBox();
  expect(photoBox && photoBox.width).toBeGreaterThan(300);
  await expect(page.getByRole('textbox', { name: 'Describe the change', exact: true })).toBeInViewport();
  await expectFits(page, 'photo');

  // Spaces pane.
  await nav(page).getByRole('button', { name: 'Spaces' }).tap();
  await expect(nav(page).getByRole('button', { name: 'Spaces' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Spaces' }).getByText('Front of house').first()).toBeVisible();
  await expectFits(page, 'spaces');

  // Design pane: every Studio panel tab.
  await nav(page).getByRole('button', { name: 'Design' }).tap();
  for (const id of ['design', 'scene', 'ideas', 'suggestions', 'history']) {
    await panelTab(page, id).tap();
    await expect(panelTab(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page)).toBeVisible();
    await expectFits(page, `studio-${id}`);
  }
  // A design element from the panel shows its option tiles within the screen.
  await panelTab(page, 'design').tap();
  await panel(page).getByRole('button', { name: 'Front door', exact: true }).tap();
  await expect(panel(page).getByRole('radio').first()).toBeVisible();
  await expectFits(page, 'studio-element');

  // Fine-tune: the canvas on the Photo pane, tool panels on the Tools pane.
  await page.getByRole('radio', { name: 'Fine-tune' }).tap();
  await nav(page).getByRole('button', { name: 'Photo' }).tap();
  await expect(page.getByTestId('editor-stage')).toBeVisible();
  await expectFits(page, 'finetune-photo');
  await nav(page).getByRole('button', { name: 'Tools' }).tap();
  for (const id of ['surfaces', 'paint', 'materials', 'lighting', 'library']) {
    await panelTab(page, id).tap();
    await expect(panelTab(page, id)).toHaveAttribute('aria-selected', 'true');
    await expectFits(page, `finetune-${id}`);
  }
});
