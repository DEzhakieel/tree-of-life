import { test, expect, type Page } from '@playwright/test';

/**
 * Small-laptop layouts (1024x768 and 800x600): the dashboard must not scroll at
 * the page level, the floating toolbar must not cover any reachable rail
 * control, and the new-world dialog must be viewport-anchored with its primary
 * action visible without scrolling.
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

for (const vp of [
  { width: 1024, height: 768 },
  { width: 800, height: 600 },
]) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('lays out without page scroll and keeps actions reachable', async ({ page }) => {
      test.setTimeout(240_000);
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await bootWorld(page);

      const pageBox = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      }));
      expect(pageBox.w).toBeLessThanOrEqual(vp.width);
      expect(pageBox.h).toBeLessThanOrEqual(vp.height);

      // the wrapping toolbar may overlap the rails' bottom padding, but never a
      // control that is still inside the rail's visible (scrollable) area
      const covered = await page.evaluate(() => {
        const bar = document.querySelector('div[data-testid="toolbar"] > div')?.getBoundingClientRect();
        if (!bar) return -1;
        let n = 0;
        for (const rail of Array.from(document.querySelectorAll('div.absolute.top-14'))) {
          const rb = rail.getBoundingClientRect();
          for (const el of Array.from(rail.querySelectorAll('button, input'))) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const insideRail = cx >= rb.x && cx <= rb.right && cy >= rb.y && cy <= rb.bottom;
            const insideBar = cx >= bar.x && cx <= bar.right && cy >= bar.y && cy <= bar.bottom;
            if (insideRail && insideBar) n++;
          }
        }
        return n;
      });
      expect(covered).toBe(0);

      // dialog is anchored to the viewport (not the blurred top bar) and its
      // sticky footer keeps Spawn on screen without scrolling
      await page.getByRole('button', { name: 'New World' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(Math.round(box.width)).toBe(vp.width);
      expect(Math.round(box.height)).toBe(vp.height);
      await expect(dialog.getByRole('button', { name: 'Spawn', exact: true })).toBeInViewport();

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
      expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
      expect(
        consoleErrors.filter((t) => !consoleFilter.test(t)),
        `console errors: ${consoleErrors.join('; ')}`,
      ).toEqual([]);
    });
  });
}
