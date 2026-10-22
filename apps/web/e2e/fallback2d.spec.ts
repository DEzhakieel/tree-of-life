import { test, expect, type Page } from '@playwright/test';

/**
 * No-WebGL environment: the app must fall back to the 2D canvas renderer and
 * still run the simulation, switch representations, draw the topology overlay
 * and expose the boundary switch (ground layers are the only loss).
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

test('runs the 2D canvas fallback when WebGL is unavailable', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // deterministic: no WebGL context is ever handed out, 2d contexts still work
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return orig.call(this, type as '2d', ...(rest as []));
    } as typeof orig;
  });

  await bootWorld(page);

  await expect(page.getByText(/2D fallback \(no WebGL\)/)).toBeVisible();

  // every representation still renders through the 2D path
  for (const name of ['Fractal', 'Network', 'Lattice', 'Particle']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/bg-indigo-500\/40/);
  }

  // boundary switch and its glyph legend stay available without WebGL
  const boundary = page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: page.getByRole('button', { name: 'Boundary', exact: true }) });
  await boundary.getByRole('button', { name: 'on', exact: true }).click();
  await expect(boundary.getByRole('button', { name: 'off', exact: true })).toBeVisible();
  await expect(page.getByText('flip-wrap', { exact: true })).toHaveCount(0);
  await boundary.getByRole('button', { name: 'off', exact: true }).click();
  await expect(page.getByText('flip-wrap', { exact: true })).toBeVisible();

  // ground layer is the one control that must be disabled, with a reason
  await expect(page.getByText(/2D fallback has no ground layer/)).toBeVisible();
  const ground = page
    .locator('div.flex.items-center.justify-between')
    .filter({ has: page.getByRole('button', { name: 'Ground', exact: true }) });
  await expect(ground.getByRole('button', { name: 'Ground', exact: true })).toBeDisabled();
  await expect(ground.locator('button[title="unavailable in this renderer"]')).toBeDisabled();

  // the 2D renderer really paints (non-transparent pixels on its canvas)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          let best = 0;
          for (const c of Array.from(document.querySelectorAll('canvas'))) {
            try {
              const ctx = c.getContext('2d');
              if (!ctx || c.width === 0 || c.height === 0) continue;
              const d = ctx.getImageData(0, 0, c.width, c.height).data;
              let lit = 0;
              for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) lit++;
              best = Math.max(best, lit);
            } catch {
              /* a WebGL canvas (none expected here) or a tainted read */
            }
          }
          return best;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(1000);

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !consoleFilter.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});
