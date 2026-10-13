/**
 * (1) Projects home → new project with a ZIP (the hardiness zone fills in
 * from the bundled table) → add a space → upload a photo (drawn in the page)
 * → the Studio shows it, ready to design.
 */
import { addSpaceWithPhoto, createProject, dockGenerate, expect, houseJpeg, panel, panelTab, studioPhoto, test } from './support';

test('new project with a ZIP, a space and a photo opens the Studio', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See your home redesigned');
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();

  // New project: the ZIP resolves to its USDA zone while typing.
  await createProject(page, { name: 'Maple Street', zip: '20817', zone: '7b' });
  await expect(page).toHaveTitle('Maple Street · Mode');
  await expect(page.getByRole('heading', { name: 'What would you like to redesign?' })).toBeVisible();
  const spaces = page.getByRole('navigation', { name: 'Spaces' });
  await expect(spaces.getByRole('button', { name: /USDA zone 7b · 20817/ })).toBeVisible();

  // The zone and ZIP are stored on the project (Settings → Project).
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog').filter({ hasText: 'Settings' });
  await settings.getByRole('tab', { name: 'Project' }).click();
  await expect(settings.getByLabel('ZIP code')).toHaveValue('20817');
  await expect(settings.getByLabel('Hardiness zone')).toHaveValue('7b');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();

  // Add a space and its photo.
  const photo = await houseJpeg(page);
  await addSpaceWithPhoto(page, { type: 'Front yard', photo, fileName: 'Front walk.jpg' });

  // The Studio: photo in the viewer, the prompt dock, the Design panel.
  await expect(studioPhoto(page)).toBeVisible();
  await expect.poll(() => studioPhoto(page).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1200);
  await expect(page.getByText('Original photo', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Describe the change', exact: true })).toBeVisible();
  await expect(dockGenerate(page)).toBeDisabled();
  await expect(panelTab(page, 'design')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByRole('heading', { name: 'Design brief' })).toBeVisible();
  await expect(spaces.getByText('Front yard').first()).toBeVisible();

  // Everything lives in this browser: back on the projects home the project is listed; it reopens with its photo.
  await page.getByRole('button', { name: 'All projects' }).click();
  const card = page.getByRole('button', { name: /Maple Street/ }).first();
  await expect(card).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Maple Street/ }).first().click();
  await expect(studioPhoto(page)).toBeVisible();
});
