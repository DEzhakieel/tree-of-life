import { test, expect, type Page } from '@playwright/test';

/**
 * Event scheduler round-trip: queueing a scripted intervention against the sim
 * clock must arm it, fire it when the clock reaches it, and leave it marked
 * done. This exercises the panel, the store queue and the worker intervention
 * path together.
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

async function tick(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (document.querySelector('[data-testid="tick-status"]')?.textContent ?? '').match(/\bt=(\d+)/);
    return m ? Number(m[1]) : -1;
  });
}

test('queued intervention fires on the sim clock', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await bootWorld(page);
  // freeze the clock so the target tick cannot slip past while the form is
  // being filled (the panel fires on its own 300ms poll)
  await page.getByRole('button', { name: /^⏸$/ }).click();
  await expect
    .poll(
      async () => {
        const a = await tick(page);
        await page.waitForTimeout(400);
        return a === (await tick(page));
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const frozen = await tick(page);

  await expect(page.getByText('Event Scheduler', { exact: true })).toBeVisible();
  // the scheduler panel ships collapsed; its body only mounts once expanded
  await page.getByTitle('expand Event Scheduler').click();
  await expect(page.getByText(/^0 pending$/)).toBeVisible();

  const fireAt = frozen + 100;

  await page.getByRole('button', { name: '+ queue intervention at tick' }).click();
  await page.locator('select:has(option[value="meteor"])').selectOption('meteor');
  await page.locator('input[title="tick to fire at"]').fill(String(fireAt));
  await page.getByPlaceholder('label (optional)').fill('e2e-meteor');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();

  await expect(page.getByText(/^1 pending$/)).toBeVisible();
  await expect(page.getByText('e2e-meteor')).toBeVisible();
  await expect(page.getByText(new RegExp(`^t${fireAt}$`))).toBeVisible();

  // resume: the panel's poll loop fires the event once the clock reaches it
  await page.getByRole('button', { name: /^▶$/ }).click();
  await expect(page.getByText(/^done@\d+$/)).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^0 pending$/)).toBeVisible();
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});
