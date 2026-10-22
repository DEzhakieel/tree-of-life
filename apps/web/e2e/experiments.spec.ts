import { test, expect, type Page } from '@playwright/test';

/**
 * Experiment directory without a backend: the bundled catalog must still load,
 * be browsable, and clearly gate the execute actions as read-only instead of
 * offering buttons that silently do nothing.
 */

const consoleFilter = /favicon|net::ERR_CONNECTION|status of 50\d/;

async function bootWorld(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('TREE OF LIFE')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(⏸|▶)$/ })).toBeVisible();
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="tick-status"]');
      const m = (el?.textContent ?? '').match(/\bt=(\d+)/);
      return m != null && Number(m[1]) > 0;
    },
    undefined,
    { timeout: 150_000 },
  );
}

test('experiment catalog loads read-only without a backend', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await bootWorld(page);
  await page.getByTitle('expand Experiments').click();

  const panel = page
    .getByText('Experiments', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"pointer-events-auto")][1]');
  await expect(panel.getByText(/No API server answering/)).toBeVisible();
  await expect(panel.getByText('read-only', { exact: true })).toBeVisible();

  const rows = panel.locator('li').filter({ has: page.getByText(/^\d+s$/) });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(panel.getByText(/^(ladder|ews)$/).first()).toBeVisible();

  await rows.first().getByRole('button').click();

  // details render, but execution is disabled and the manifest is absent
  const meta = panel.getByText(/kind (ladder|ews)/);
  await expect(meta).toBeVisible();
  await expect(meta).toContainText(/seeds?/);
  await expect(panel.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  const reproduce = panel.getByRole('button', { name: 'Reproduce', exact: true });
  await expect(reproduce).toBeDisabled();
  await expect(reproduce).toHaveAttribute('title', 'no recorded manifest yet');
  await expect(panel.getByText('no manifest', { exact: true })).toBeVisible();
  await expect(panel.getByRole('checkbox')).toBeEnabled();

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});
