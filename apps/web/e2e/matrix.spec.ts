import { test, expect, type Page } from '@playwright/test';

/**
 * Creation-matrix coverage: every non-agent substrate and every non-torus
 * topology must boot, identify itself on the world badge, and advance ticks.
 * (agents/lattice/cylinder/torus are covered by dashboard + smoke specs.)
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

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'New World' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pick(page: Page, dialog: ReturnType<Page['getByRole']>, name: string): Promise<void> {
  // the dialog scrolls; bypass actionability so a sticky footer can never
  // intercept the click, matching the existing dashboard spec
  await dialog.getByRole('button', { name, exact: true }).evaluate((el) => (el as HTMLButtonElement).click());
}

async function spawn(page: Page, dialog: ReturnType<Page['getByRole']>): Promise<void> {
  await dialog.getByRole('button', { name: 'Spawn', exact: true }).click();
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
}

async function tick(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (document.querySelector('[data-testid="tick-status"]')?.textContent ?? '').match(/\bt=(\d+)/);
    return m ? Number(m[1]) : -1;
  });
}

async function expectTicksAdvance(page: Page): Promise<void> {
  const start = await tick(page);
  await expect.poll(() => tick(page), { timeout: 90_000 }).toBeGreaterThan(Math.max(start, 0));
}

const cases: {
  name: string;
  pick: string;
  knob: string;
  badge: RegExp;
  representation: string;
}[] = [
  {
    name: 'particles substrate',
    pick: 'Particles',
    knob: 'Attraction gain',
    badge: /substrate\s+particles/,
    representation: 'Particle',
  },
  {
    name: 'graph substrate',
    pick: 'Graph',
    knob: 'Link radius',
    badge: /substrate\s+graph/,
    representation: 'Network',
  },
  {
    name: 'sphere topology',
    pick: 'sphere',
    knob: '',
    badge: /boundary\s+sphere/,
    representation: 'Particle',
  },
  {
    name: 'mobius topology',
    pick: 'möbius',
    knob: '',
    badge: /boundary\s+möbius/,
    representation: 'Particle',
  },
  {
    name: 'klein bottle topology',
    pick: 'klein bottle',
    knob: '',
    badge: /boundary\s+klein bottle/,
    representation: 'Particle',
  },
];

for (const c of cases) {
  test(`${c.name} boots, identifies itself and ticks`, async ({ page }) => {
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await bootWorld(page);
    const dialog = await openDialog(page);
    await pick(page, dialog, c.pick);
    if (c.knob) await expect(dialog.getByText(c.knob)).toBeVisible();
    await spawn(page, dialog);

    await expect(page.getByText(c.badge)).toBeVisible({ timeout: 150_000 });
    await expect(page.getByRole('button', { name: c.representation, exact: true })).toHaveClass(
      /bg-indigo-500\/40/,
      { timeout: 30_000 },
    );
    await expectTicksAdvance(page);

    await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);
    expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
    expect(
      consoleErrors.filter((t) => !consoleFilter.test(t)),
      `console errors: ${consoleErrors.join('; ')}`,
    ).toEqual([]);
  });
}
