import { test, expect, type Page } from '@playwright/test';

/**
 * Model hierarchy: tiers are drill-downs over live pattern readings, and the
 * patterns that have a spatial reading double as ground-layer switches. This
 * ties the model panel to the display panel so the two cannot drift apart.
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

test('model tiers expand and mapped patterns switch the ground layer', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await bootWorld(page);
  await expect(page.getByText('Model hierarchy')).toBeVisible();

  // geometry is open by default and reads a live box-counting dimension
  await expect(page.getByText('Fractals', { exact: true })).toBeVisible();
  await expect(page.getByText(/^D \d\.\d{2}$/).first()).toBeVisible();
  await expect(page.getByText('Waves', { exact: true })).toHaveCount(0);

  // expanding a tier reveals its pattern readings
  await page.getByRole('button', { name: /Dynamics/ }).click();
  await expect(page.getByText('Waves', { exact: true })).toBeVisible();
  await expect(page.getByText(/^rings \d+$/)).toBeVisible();

  // the evolved-set ground is the default, so Fractals is the active pattern
  const evolvedSet = page.getByRole('button', { name: 'Evolved set', exact: true });
  const density = page.getByRole('button', { name: 'Density', exact: true });
  await expect(evolvedSet).toHaveClass(/bg-indigo-500\/40/);
  await expect(density).not.toHaveClass(/bg-indigo-500\/40/);

  // Matter > Packing is mapped to the density ground layer
  await page.getByRole('button', { name: /Matter/ }).click();
  const packing = page.getByRole('button', { name: /Packing/ });
  await expect(packing).toBeVisible();
  await packing.click();

  await expect(density).toHaveClass(/bg-indigo-500\/40/);
  await expect(evolvedSet).not.toHaveClass(/bg-indigo-500\/40/);
  await expect(packing).toHaveClass(/bg-indigo-500\/20/);

  // and back to the evolved set from the geometry tier
  await page.getByRole('button', { name: /Fractals/ }).click();
  await expect(evolvedSet).toHaveClass(/bg-indigo-500\/40/);
  await expect(density).not.toHaveClass(/bg-indigo-500\/40/);

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});
