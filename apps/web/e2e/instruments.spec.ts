import { test, expect, type Page } from '@playwright/test';

/**
 * Instrument health: the dashboard is only a scientific tool if the telemetry
 * panels actually hydrate from the running world (not just render empty
 * shells) and both secondary canvases (minimap, signals chart) paint.
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

test('telemetry panels hydrate and the secondary canvases paint', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await bootWorld(page);
  // give the engines a little history so every panel has something to show
  await expect.poll(() => tick(page), { timeout: 90_000 }).toBeGreaterThan(10);

  // Vitals: live population rows and a state hash
  await expect(page.getByText('Vitals', { exact: true })).toBeVisible();
  const aliveRow = page.locator('tr').filter({ has: page.getByText('Alive', { exact: true }) });
  const alive = Number(await aliveRow.locator('td').nth(1).innerText());
  expect(alive, 'alive population readout').toBeGreaterThan(0);
  await expect(page.getByText(/^#[0-9a-f]{8}$/)).toBeVisible();

  // Species: at least one population row appears from the agent buffer
  await expect(page.getByText(/^sp\.\d+$/).first()).toBeVisible({ timeout: 30_000 });

  // Atlas + radar: sample counters advance past the empty state
  await expect(page.getByText(/^\d+ pts$/).first()).toBeVisible({ timeout: 90_000 });

  // Minimap and the observables chart must actually have pixels
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          let painted = 0;
          for (const c of Array.from(document.querySelectorAll('canvas'))) {
            if (!c.width || !c.height) continue;
            const ctx = c.getContext('2d');
            if (!ctx) continue;
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let i = 3; i < d.length; i += 4) {
              if (d[i]! > 0 && ++lit > 50) break;
            }
            if (lit > 50) painted++;
          }
          return painted;
        }),
      { timeout: 45_000 },
    )
    .toBeGreaterThanOrEqual(2);

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});
