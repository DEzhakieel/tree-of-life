import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard instrument checks: the controls that used to be silently inert
 * (representations, overlays, genealogy, topology, substrate) must be wired
 * end-to-end — click, visible state change, world metadata reflected.
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
      if (!el) return false;
      const m = (el.textContent ?? '').match(/\bt=(\d+)/);
      return m != null && Number(m[1]) > 0;
    },
    undefined,
    { timeout: 150_000 },
  );
}

function watchErrors(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

function displayRow(page: Page, label: string) {
  return page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: page.getByRole('button', { name: label, exact: true }) });
}

test('display panel drives representations, boundary and ground overlays', async ({ page }) => {
  test.setTimeout(240_000);
  const { pageErrors, consoleErrors } = watchErrors(page);
  await bootWorld(page);

  const rep = (name: string) => page.getByRole('button', { name, exact: true });

  // Every representation must activate. No renderer may crash on a switch.
  for (const name of ['Fractal', 'Network', 'Lattice', 'Particle']) {
    await rep(name).click();
    await expect(rep(name)).toHaveClass(/bg-indigo-500\/40/);
  }

  // Boundary overlay is a real switch (both renderers draw it).
  const boundary = displayRow(page, 'Boundary');
  await boundary.getByRole('button', { name: 'on', exact: true }).click();
  await expect(boundary.getByRole('button', { name: 'off', exact: true })).toBeVisible();
  await boundary.getByRole('button', { name: 'off', exact: true }).click();
  await expect(boundary.getByRole('button', { name: 'on', exact: true })).toBeVisible();

  // Picking fractal now enables the ground overlay instead of silently forcing
  // it in the renderer only — so switching back leaves the ground visible.
  const is2D = (await page.getByText(/2D fallback/).count()) > 0;
  if (!is2D) {
    await rep('Fractal').click();
    await rep('Particle').click();
    const ground = displayRow(page, 'Ground');
    await expect(ground.getByRole('button', { name: 'on', exact: true })).toBeVisible();
    await ground.getByRole('button', { name: 'on', exact: true }).click();
    await expect(ground.getByRole('button', { name: 'off', exact: true })).toBeVisible();
  }

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});

test('genealogy toggle opens and closes the line panel', async ({ page }) => {
  test.setTimeout(240_000);
  await bootWorld(page);

  const toolbar = page.getByTestId('toolbar');
  const lineageBtn = toolbar.getByRole('button', { name: 'Genealogy', exact: true });
  const panelToggle = page.locator('button[title="collapse Genealogy"]');

  await expect(panelToggle).toHaveCount(0);
  await lineageBtn.click();
  await expect(lineageBtn).toHaveClass(/bg-indigo-500\/40/);
  await expect(panelToggle).toBeVisible();

  await lineageBtn.click();
  await expect(panelToggle).toHaveCount(0);
  await expect(lineageBtn).not.toHaveClass(/bg-indigo-500\/40/);
});

test('world badge reports the chosen boundary topology', async ({ page }) => {
  test.setTimeout(240_000);
  await bootWorld(page);

  // the boot world is a torus (no explicit topology)
  await expect(page.getByText(/boundary\s+torus/)).toBeVisible();

  await page.getByRole('button', { name: 'New World' }).click();
  const modal = page.locator('.fixed.inset-0');
  const panel = modal.locator('div.overflow-y-auto');
  await panel
    .getByRole('button', { name: 'cylinder', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await modal.getByRole('button', { name: 'Spawn', exact: true }).click();

  await expect(page.getByText(/substrate\s+agents/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/boundary\s+cylinder/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
});

test('lattice substrate boots with its own representation and knobs', async ({ page }) => {
  test.setTimeout(300_000);
  await bootWorld(page);

  await page.getByRole('button', { name: 'New World' }).click();
  const modal = page.locator('.fixed.inset-0');
  const panel = modal.locator('div.overflow-y-auto');
  await panel
    .getByRole('button', { name: 'Lattice', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(panel.getByText('Flip noise')).toBeVisible();

  await modal.getByRole('button', { name: 'Spawn', exact: true }).click();

  // substrate + boundary read out on the world badge, and the lattice view is
  // auto-selected instead of inheriting the previous world's representation
  await expect(page.getByText(/substrate\s+lattice/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/boundary\s+torus/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('button', { name: 'Lattice', exact: true })).toHaveClass(
    /bg-indigo-500\/40/,
  );
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
});
