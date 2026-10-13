/**
 * (4) Settings: the theme switch (System / Light / Dark, remembered on this
 * device) and the Gemini plan (Free / Google AI plan), which changes what the
 * hand-off companion tells the user about Gemini.
 */
import type { Page } from '@playwright/test';
import { addSpaceWithPhoto, createProject, dockGenerate, expect, houseJpeg, studioPhoto, test } from './support';

/** Luminance (0–255) of the page background. */
function bodyLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(document.body).backgroundColor);
    if (!m) return -1;
    return 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
  });
}

function settingsDialog(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByRole('tablist', { name: 'Settings sections' }) });
}

test('theme: Dark and Light override the system setting and are remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect(await bodyLuminance(page)).toBeGreaterThan(180);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = settingsDialog(page);
  await expect(settings.getByRole('tab', { name: 'Appearance' })).toHaveAttribute('aria-selected', 'true');
  const theme = settings.getByRole('radiogroup', { name: 'Theme' });
  await expect(theme.getByRole('radio', { name: /^System/ })).toHaveAttribute('aria-checked', 'true');

  await theme.getByRole('radio', { name: /^Dark/ }).click();
  await expect(theme.getByRole('radio', { name: /^Dark/ })).toHaveAttribute('aria-checked', 'true');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => bodyLuminance(page)).toBeLessThan(70);

  // Remembered across reloads, even though the system is light.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => bodyLuminance(page)).toBeLessThan(70);

  // Light wins over a dark system setting; System follows it again.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^Light/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => bodyLuminance(page)).toBeGreaterThan(180);
  await settings.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: /^System/ }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  await expect.poll(() => bodyLuminance(page)).toBeLessThan(70);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
});

test('Gemini plan: the setting is remembered and changes the hand-off companion', async ({ page }) => {
  // Settings from the projects home: Images → Hand-off → Gemini plan (not set = treated as Free).
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = settingsDialog(page);
  await settings.getByRole('tab', { name: 'Images' }).click();
  const plan = settings.getByRole('group', { name: 'Gemini plan' });
  await expect(plan.getByRole('radio', { name: 'Free' })).toHaveAttribute('aria-checked', 'true');
  await expect(plan).toContainText('Not set — treated as Free.');
  await plan.getByRole('radio', { name: 'Google AI plan' }).click();
  await expect(plan.getByRole('radio', { name: 'Google AI plan' })).toHaveAttribute('aria-checked', 'true');
  await expect(plan).toContainText('Redo with Pro');
  await settings.getByRole('button', { name: 'Close' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await settings.getByRole('tab', { name: 'Images' }).click();
  await expect(plan.getByRole('radio', { name: 'Google AI plan' })).toHaveAttribute('aria-checked', 'true');
  // Back to Free for the companion check below.
  await plan.getByRole('radio', { name: 'Free' }).click();
  await expect(plan.getByRole('radio', { name: 'Free' })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', { name: 'Close' }).click();

  // A hand-off to Gemini on the Free plan: the companion warns and suggests ChatGPT.
  await createProject(page, { name: 'Gemini plan' });
  await addSpaceWithPhoto(page, { type: 'Front of house', photo: await houseJpeg(page), fileName: 'House.jpg' });
  await expect(studioPhoto(page)).toBeVisible();
  await page.getByRole('textbox', { name: 'Describe the change', exact: true }).fill('Paint the front door deep navy');
  await page.getByRole('radio', { name: 'Gemini' }).click();
  await expect(page.getByRole('radio', { name: 'Gemini' })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Variations per run').selectOption('1');
  await dockGenerate(page).click();
  const review = page.getByRole('dialog').filter({ hasText: 'Review before handing off to Gemini' });
  const send = review.getByRole('button', { name: 'Send to Gemini' });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  const companion = page.getByRole('dialog', { name: 'Hand-off companion' });
  await expect(companion.getByRole('button', { name: /Copy photo & open Gemini/ })).toBeVisible();
  const note = companion.getByRole('note').filter({ hasText: 'edits may be weak' });
  await expect(note).toContainText('Gemini Free');
  await expect(note.getByRole('button', { name: 'Use ChatGPT instead' })).toBeVisible();

  // Switching to the Google AI plan in Settings removes the warning right away.
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await settings.getByRole('tab', { name: 'Images' }).click();
  await plan.getByRole('radio', { name: 'Google AI plan' }).click();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  await expect(note).toBeHidden();
  await expect(companion.getByRole('button', { name: /Copy photo & open Gemini/ })).toBeVisible();
});
