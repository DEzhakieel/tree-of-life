import { test, expect } from '@playwright/test';

/**
 * Genome toolchain: spawn a cluster of agents at the view center, pick one
 * with the Pan tool, inspect its genome in the inspector, then load that
 * genome into the designer (which arms the Spawn tool).
 */
test('pick an agent, inspect its genome, load it into the designer', async ({ page }) => {
  // Whole-flow integration: world boot + two spawn/step/pick round-trips
  // routinely exceed 90s under system load. Give it room.
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await expect(page.getByText('TREE OF LIFE')).toBeVisible();
  await expect(page.getByText(/Boot Error|Worker Error/)).toHaveCount(0);

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="tick-status"]');
      if (!el) return false;
      const m = (el.textContent ?? '').match(/\bt=(\d+)/);
      return m != null && Number(m[1]) > 0;
    },
    undefined,
    { timeout: 120_000 },
  );

  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  // Drop a fresh cluster of agents at the view center. Pause first: the pick
  // buffer only holds agents from the latest delta frame, so we need the drop
  // to land in a delta (a step does that) with the world frozen (nothing else
  // moves). See the designer round-trip below for the same reasoning.
  await page.getByRole('button', { name: /Spawn/ }).click();
  await page.getByRole('button', { name: '⏸', exact: true }).click();
  await expect(page.getByRole('button', { name: '▶', exact: true })).toBeVisible({ timeout: 5_000 });
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(30);
  }
  await page.getByRole('button', { name: /⏭/ }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /Pan/ }).click();

  // Pick at the exact drop point: the freshly stepped cluster sits at ~zero
  // distance, so it wins the hit. Re-click + poll until the inspector binds a
  // genome actually carrying the trait grid (async worker roundtrip).
  const inspectorAgentId = () => page.getByText(/Agent #\d+/).first().innerText().catch(() => '');
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(200);
    if (!(await inspectorAgentId()).startsWith('Agent')) continue;
    try {
      await expect(page.getByText('requesting genome…')).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByText(/^immune \d+\.\d{2,3}$/)).toBeVisible();
      break;
    } catch {
      // picked a corpse / not yet genome-ready — re-pick a live one
    }
  }

  // The inspector should show a picked agent with genome summaries unlocked.
  await expect(page.getByText(/Agent #\d+/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/^immune \d+\.\d{2,3}$/)).toBeVisible();

  // Resume the loop; the designer round-trip below pauses again on its own.
  await page.getByRole('button', { name: '▶', exact: true }).click();
  await expect(page.getByRole('button', { name: '⏸', exact: true })).toBeVisible({ timeout: 5_000 });

  // Push the inspected genome into the designer: panel appears, Spawn armed.
  await page.getByRole('button', { name: /load into designer/ }).click();
  await expect(page.getByText('Genome Designer')).toBeVisible();
  await expect(page.getByText(/design loaded \(217 genes\)/)).toBeVisible();

  // The designer's editor is live and reports the row set.
  await expect(page.getByText('editing')).toBeVisible();
  await expect(page.locator('button', { hasText: 'jitter block' }).first()).toBeVisible();

  // ── The designed genome actually lands in the world ─────────────────────
  // Rewrite a gene in the designer so the drop is distinguishable from the
  // source agent. Gene 0 (speed) is NOT usable — it doubles as the fractal
  // c_re locus (genome.rs:167/187), so -1 makes the clone's orbit escape on
  // tick one and the clone dies instantly. Gene 3 (color R) is cosmetic-safe
  // but sits inside the species hash (selection.rs hashes genes 0..32), so
  // editing it diverges the clone's species from its parent. Use gene 110
  // (a pattern-drive weight ≥ 32): safe to carry and keeps the clone's
  // species identical, so the picked clone's gene 110 == -1 is unambiguous.
  const editRow = '110';
  const designBrowser = page.getByTestId('genome-browser').filter({ has: page.getByText('editing', { exact: true }) });
  const designRow = () => designBrowser.locator(`span:text-is("${editRow}")`).locator('..');

  // Playwright cannot `fill()` range inputs, so use the native-value-setter
  // trick and dispatch the events React listens on.
  await designRow()
    .locator('input[type="range"]')
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '-1');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const expectedGene = '-1.000';
  await expect.poll(() => designRow().locator('span.text-right').innerText()).toBe(expectedGene);

  // Drop a modest cluster of designed clones at a clear spot. Order matters:
  //  (1) PAUSE first — the world stops growing, so no passers-by can crowd the
  //      drop point while we work (picking it later becomes deterministic);
  //  (2) drop the clones into the paused engine — interventions are applied
  //      even while paused;
  //  (3) STEP one tick — the step's delta frame carries the just-spawned
  //      clones, so the render/pick buffer now actually contains them at
  //      (essentially) the click coordinates (a paused world alone emits no
  //      deltas, so without the step the buffer would still be pre-spawn).
  const dropX = cx - 260;
  const dropY = cy - 60;
  await page.getByRole('button', { name: '⏸', exact: true }).click();
  await expect(page.getByRole('button', { name: '▶', exact: true })).toBeVisible({ timeout: 5_000 });
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(dropX, dropY);
    await page.waitForTimeout(30);
  }
  await page.getByRole('button', { name: /⏭/ }).click();
  await page.waitForTimeout(300);

  // Re-pick at the drop point and read the inspector: the clone is at ~zero
  // distance from the click (the step froze the world, so nothing has drifted),
  // so it wins the inside-the-16px hit-box race. The gene value only appears
  // after the worker's genome-summary roundtrip, so re-click + poll until the
  // inspector actually shows the edited value (-1) — this tolerates both the
  // async genome load and an occasionally-missed first pick.
  const inspectorBrowser = page.getByTestId('genome-browser').filter({ has: page.getByText('genome', { exact: true }) });
  const inspectorRow = () => inspectorBrowser.locator(`span:text-is("${editRow}")`).locator('..');
  const readGene = () => inspectorRow().locator('span.text-right').innerText().catch(() => '');
  await page.getByRole('button', { name: /Pan/ }).click();

  let cloneBound = false;
  for (let attempt = 0; attempt < 12 && !cloneBound; attempt++) {
    await page.mouse.click(dropX, dropY);
    await expect
      .poll(async () => { const t = await readGene(); return t === '' ? NaN : Number(t); }, {
        timeout: 3_000,
        message: `inspector gene ${editRow} after pick #${attempt + 1}`,
      })
      .toBeLessThan(-0.9)
      .catch(() => {}); // matched the clone if true; else try the next re-pick
    cloneBound = Number((await readGene().catch(() => '0')) || '0') < -0.9;
  }
  expect(cloneBound, 'inspector eventually bound to a designed clone (gene 110 ≈ -1)').toBe(true);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
});