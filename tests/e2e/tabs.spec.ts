/**
 * (6) One project open in two tabs: only one of them saves it. Tab A opens a
 * project; the same address in tab B reopens it (the last open project) as a
 * read-only copy with "Open in another tab" + Take over. After B takes over,
 * A shows the notice and a rename typed in A is not saved.
 */
import { createProject, expect, shot, test } from './support';

test('a second tab opens the project read-only, Take over moves saving to it', async ({ page, context }) => {
  await createProject(page, { name: 'Two tabs house' });
  // Tab A saves the project: no notice here.
  const noticeA = page.getByRole('status').filter({ hasText: 'Open in another tab' });
  await expect(noticeA).toHaveCount(0);

  // --- Tab B: same address → the project reopens, read-only while A has it.
  const tabB = await context.newPage();
  const errorsB: string[] = [];
  tabB.on('pageerror', (e) => errorsB.push(e.message));
  await tabB.goto('/');
  await expect(tabB).toHaveTitle('Two tabs house · Mode');
  const noticeB = tabB.getByRole('status').filter({ hasText: 'Open in another tab' });
  await expect(noticeB).toBeVisible();
  await expect(noticeB).toContainText('Changes made here are not saved.');
  await shot(tabB, 'tabs-1-second-tab-read-only');

  // --- Take over in B: B saves from now on, A turns read-only.
  await noticeB.getByRole('button', { name: 'Take over' }).click();
  await expect(noticeB).toBeHidden();
  await page.bringToFront();
  await expect(noticeA).toBeVisible();
  await expect(noticeA.getByRole('button', { name: 'Take over' })).toBeVisible();
  await shot(page, 'tabs-2-first-tab-after-take-over');

  // --- A rename typed in A shows there but is never saved.
  await page.getByTitle('Rename project').first().click();
  await page.getByLabel('Project name').fill('Renamed in tab A');
  await page.getByLabel('Project name').press('Enter');
  await expect(page).toHaveTitle('Renamed in tab A · Mode');
  await page.waitForTimeout(1500); // longer than the autosave delay

  // B (the saving tab) reloads its stored copy: still the old name; A's edit stayed in A.
  await tabB.reload();
  await expect(tabB).toHaveTitle('Two tabs house · Mode');
  await expect(tabB.getByRole('status').filter({ hasText: 'Open in another tab' })).toHaveCount(0);
  await expect(tabB.getByTitle('Rename project').first()).toHaveText('Two tabs house');
  expect(errorsB, 'uncaught errors in tab B').toEqual([]);
  await tabB.close();
});
