import { test, expect } from '@playwright/test';

test('boots the local WASM world and simulates', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');

  await expect(page.getByText('TREE OF LIFE')).toBeVisible();
  await expect(page.getByRole('button', { name: /^(⏸|▶)$/ })).toBeVisible();
  await expect(
    page.getByText(/Boot Error|Worker Error/),
  ).toHaveCount(0);

  await page.waitForFunction(
    () => {
      const el = document.querySelector('span.font-mono');
      if (!el) return false;
      const txt = el.textContent ?? '';
      const m = txt.match(/\bt=(\d+)/);
      return m != null && Number(m[1]) > 0;
    },
    undefined,
    { timeout: 150_000 },
  );

  const tickText = await page.locator('span.font-mono').first().textContent();
  expect(tickText).toMatch(/t=[1-9]\d*/);

  const speed = page.getByText(/tps/).first();
  await expect(speed).toBeVisible();

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(
    // Backend-less runs are expected: the experiments health probe and the
    // event-sink config probe both hit the vite /api proxy, which answers 5xx
    // when no server is up. Real regressions surface as pageerror, Boot Error,
    // or a dead worker (asserted above and below), not as these probe messages.
    consoleErrors.filter((t) => !/favicon|net::ERR_CONNECTION|status of 50\d/.test(t)),
    `console errors: ${consoleErrors.join('; ')}`,
  ).toEqual([]);
});

test('pause button roundtrips through the worker', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');

  const btn = page.getByRole('button', { name: /^(⏸|▶)$/ });
  await expect(btn).toBeVisible();
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);

  const first = (await btn.textContent())?.trim();
  await btn.click();
  await expect(btn).not.toHaveText(first ?? '');
  await btn.click();
  await expect(btn).toHaveText(first ?? '');
});

test('new world modal: physics frame + cell bio/omics shape the booted world', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'New World' }).click();
  await expect(page.getByText('Spawn a new world')).toBeVisible();

  const modal = page.locator('.fixed.inset-0');
  const panel = modal.locator('div.overflow-y-auto');
  // The toggles sit below the fold inside the modal's scroll panel;
  // Playwright's nested-scroll actionability can't reach them there, so drive
  // the real React onClick handlers via DOM clicks instead.
  await panel.locator('button[title="off"]').evaluate((el) => (el as HTMLButtonElement).click());
  await expect(modal.locator('button[title="on"]')).toBeVisible();
  await panel.locator('button[title="omics off"]').evaluate((el) => (el as HTMLButtonElement).click());
  await expect(modal.locator('button[title="omics on"]')).toBeVisible();
  await panel.getByRole('button', { name: 'Moon', exact: true }).evaluate((el) => (el as HTMLButtonElement).click());

  await modal.getByRole('button', { name: 'Spawn', exact: true }).click();

  await page.waitForFunction(
    () => {
      const el = document.querySelector('span.font-mono');
      if (!el) return false;
      const m = (el.textContent ?? '').match(/\bt=(\d+)/);
      return m != null && Number(m[1]) > 0;
    },
    undefined,
    { timeout: 150_000 },
  );

  // The omics telemetry group must be present in the Signals panel and expose
  // its 8 signal toggles once the flagged world streams stats.
  const omicsRow = page.locator('div.flex.w-full').filter({ hasText: 'Omics' });
  await expect(omicsRow).toBeVisible();
  await omicsRow.getByRole('button', { name: 'on', exact: true }).click();
  await expect(page.getByText('transcription', { exact: true })).toBeVisible();
  await expect(page.getByText('pathway flux', { exact: true })).toBeVisible();

  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
});