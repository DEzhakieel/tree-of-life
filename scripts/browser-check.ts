/**
 * Headless-browser dashboard check. Launches Edge via CDP against the vite dev
 * server, collects console errors/exceptions, and exercises a few dashboard
 * interactions (New World modal, god tools, layer toggles).
 *
 * Run: npm exec tsx -- scripts/browser-check.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = process.env.APP_URL ?? 'http://localhost:5173';
const DEBUG_PORT = 9333;
const PROFILE = process.env.TEMP + '\\opencode\\edge-browser-check';
const EXTRA_GL = (process.env.EDGE_GL ?? '--enable-unsafe-swiftshader,--use-angle=swiftshader').split(',');

interface CdpEvent {
  method: string;
  params: unknown;
}

async function main(): Promise<void> {
  const child: ChildProcess = spawn(EDGE, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    ...EXTRA_GL,
    '--no-first-run',
    '--disable-extensions',
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const errors: string[] = [];
  const logs: string[] = [];
  let sawException = false;

  try {
    // wait for the debugging endpoint
    let targets: { webSocketDebuggerUrl: string }[] = [];
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const list = (await r.json()) as { type: string; webSocketDebuggerUrl?: string }[];
        targets = list.filter((t) => t.type === 'page') as { webSocketDebuggerUrl: string }[];
        if (targets.length > 0) break;
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    if (targets.length === 0) throw new Error('CDP endpoint never came up');

    const ws = new WebSocket(targets[0]!.webSocketDebuggerUrl);
    const pending = new Map<number, (v: unknown) => void>();
    let msgId = 0;

    function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        const body: Record<string, unknown> = { id, method, params };
        pending.set(id, resolve);
        ws.send(JSON.stringify(body));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 10000);
      });
    }

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
      };
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg.result);
        pending.delete(msg.id);
        return;
      }
      const p = msg.params as Record<string, unknown> | undefined;
      if (msg.method === 'Runtime.exceptionThrown') {
        sawException = true;
        const d = p?.['exceptionDetails'] as Record<string, unknown> | undefined;
        const text = d?.['text'] ?? 'exception';
        const ex = d?.['exception'] as Record<string, unknown> | undefined;
        const desc = (ex?.['description'] as string) ?? '';
        errors.push(`EXCEPTION: ${text} ${desc}`.slice(0, 2000));
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const type = p?.['type'] as string;
        const args = (p?.['args'] as { value?: unknown; description?: string }[] ?? [])
          .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ''))
          .join(' ');
        if (type === 'error') errors.push(`CONSOLE.ERROR: ${args}`.slice(0, 2000));
        else logs.push(`[${type}] ${args}`.slice(0, 500));
      }
      if (msg.method === 'Log.entryAdded') {
        const e = p?.['entry'] as Record<string, unknown> | undefined;
        if (e?.['level'] === 'error') {
          errors.push(`LOG.ERROR: ${String(e?.['text'] ?? '')} ${String(e?.['url'] ?? '')}`.slice(0, 2000));
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: APP });
    await sleep(6000); // let the sim mount and tick a few frames

    const evalJs = async (expr: string): Promise<{ value: unknown; exception?: string }> => {
      const res = (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })) as {
        result?: { value?: unknown; description?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };
      if (res.exceptionDetails) {
        return { value: undefined, exception: res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'evaluate failed' };
      }
      return { value: res.result?.value };
    };

    const checks: { name: string; pass: boolean; detail: string }[] = [];
    const check = (name: string, pass: boolean, detail = ''): void => {
      checks.push({ name, pass, detail });
      console.log(`[check] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    };

    const body = await evalJs(`document.body ? document.body.innerText.slice(0, 300) : '(no body)'`);
    check('page mounts with title', String(body.value ?? '').includes('FRACTAL LIFE'), String(body.value ?? '').slice(0, 120));

    const canvasCount = await evalJs(`document.querySelectorAll('canvas').length`);
    check('renderer + minimap canvases', (canvasCount.value as number) >= 2, `canvases=${canvasCount.value}`);

    const buttons = await evalJs(`[...document.querySelectorAll('button')].map(b => b.innerText).filter(Boolean).join('|')`);    const btnText = String(buttons.value ?? '');
    for (const expected of ['☄ Meteor', '🌾 Seed food', '🧬 Spawn', '❄ Freeze', '💥 Nuke', '🌳 Lineage', 'New World']) {
      if (!btnText.includes(expected)) check(`toolbar button present: ${expected}`, false);
    }
    check('toolbar buttons present', ['☄ Meteor', '🌾 Seed food', '🧬 Spawn', '❄ Freeze', '💥 Nuke', '🌳 Lineage'].every((b) => btnText.includes(b)));

    // New World modal opens
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'New World')?.click(); true`);
    await sleep(400);
    const modal = await evalJs(`document.body.innerText.includes('Spawn a new world')`);
    check('New World modal opens', modal.value === true);

    // Fractal type switch to Julia shows cReal/cImag
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Julia')?.click(); true`);
    await sleep(300);
    const juliaParams = await evalJs(`document.body.innerText.includes('cReal') && document.body.innerText.includes('cImag')`);
    check('Julia shows cReal/cImag fields', juliaParams.value === true);

    // Spawn a LOCAL world and let it tick
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Local (Worker)')?.click(); true`);
    await sleep(200);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Spawn')?.click(); true`);
    await sleep(4000);

    // Diagnostics: WebGL2 + GLSL3 compile check for the terrain shader environment
    const glslCheck = await evalJs(`(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'no webgl2';
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, '#version 300 es\\nprecision highp float;\\nin vec2 position;\\nvoid main(){ gl_Position = vec4(position,0.,1.); }');
      gl.compileShader(vs);
      const ok = gl.getShaderParameter(vs, gl.COMPILE_STATUS) === true;
      const log = gl.getShaderInfoLog(vs) || '';
      return JSON.stringify({ webgl2: true, compile: ok, log: log.slice(0, 120) });
    })()`);
    console.log('[browser] glsl diag', glslCheck.value);

    const statsText = await evalJs(`document.body.innerText`);
    const statsAlive = /Alive\s+(\d+)/.exec(String(statsText.value ?? ''));
    check('local world ticks (Alive > 0)', statsAlive !== null && Number(statsAlive[1]) > 0, statsAlive ? `alive=${statsAlive[1]}` : 'no Alive stat');

    // Select the meteor tool then verify it toggles active
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Meteor'))?.click(); true`);
    await sleep(300);
    const toolActive = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('Meteor') && b.className.includes('bg-indigo'))`);
    check('meteor tool activates', toolActive.value === true);

    // Toggle the Agents layer off
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Agents')?.click(); true`);
    await sleep(300);
    const agentsOff = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText === 'Agents' && !b.className.includes('bg-emerald'))`);
    check('Agents layer toggles off', agentsOff.value === true);

    // --- Transport control: pause freezes ticks, step advances by one, resume continues
    const pausedBtn = await evalJs(`[...document.querySelectorAll('button')].find(b => ['⏸', '▶'].includes(b.innerText))?.innerText`);
    check('pause button present', pausedBtn.value === '⏸', String(pausedBtn.value));

    const readTick = async (): Promise<string | null> => {
      const body = await evalJs(`document.body.innerText`);
      return /t=(\d+)/.exec(String(body.value ?? ''))?.[1] ?? null;
    };
    // The DOM t= only refreshes on stats frames (server: every 30 ticks), so a
    // resumed world can take a while to show up on screen under load. Poll until
    // it strictly increases instead of asserting a fixed sleep window.
    const waitForTickIncrease = async (base: number, timeoutMs: number): Promise<number | null> => {
      const deadline = Date.now() + timeoutMs;
      let last: number | null = null;
      while (Date.now() < deadline) {
        const t = Number(await readTick());
        if (Number.isFinite(t)) {
          last = t;
          if (t > base) return t;
        }
        await sleep(250);
      }
      return last;
    };
    const waitForButton = async (label: string, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText === ${JSON.stringify(label)})`);
        if (r.value === true) return true;
        await sleep(120);
      }
      return false;
    };
    // The worker posts one `debug` line per control with its authoritative tick,
    // which the DOM display lags behind (stats throttle + main-thread load).
    const controlLog = async (): Promise<string> => {
      const r = await evalJs(`window.__controlLog ?? ''`);
      return String(r.value ?? '');
    };
    const lastTickIn = (log: string): number | null => {
      const all = [...log.matchAll(/tick=(\d+)/g)];
      return all.length ? Number(all[all.length - 1][1]) : null;
    };
    const waitForLogLine = async (needle: string, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await controlLog()).includes(needle)) return true;
        await sleep(150);
      }
      return false;
    };

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '⏸')?.click(); true`);
    const pauseSynced = await waitForButton('▶', 4000);
    check('pause syncs UI to ▶', pauseSynced);
    const pauseTick = lastTickIn(await controlLog());
    await sleep(500);
    const pt1 = await readTick();
    await sleep(800);
    const pt2 = await readTick();
    check('pause freezes ticks', pt1 !== null && pt1 === pt2, `t=${pt1} -> ${pt2}`);

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '⏭')?.click(); true`);
    const stepped = await waitForLogLine('step ', 4000);
    const stepTick = lastTickIn(await controlLog());
    check(
      'step advances exactly one tick',
      stepped && pauseTick !== null && stepTick === pauseTick + 1,
      `engine tick ${pauseTick} -> ${stepTick}`,
    );

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '▶')?.click(); true`);
    const playSynced = await waitForButton('⏸', 4000);
    check('resume syncs UI to ⏸', playSynced);
    await sleep(500);
    const rt1 = await readTick();
    await sleep(800);
    const rt2 = await readTick();
    check('resume resumes ticking', rt1 !== null && rt2 !== null && Number(rt2) > Number(rt1), `t=${rt1} -> ${rt2}`);

    // --- Layer panel: minimap toggle, layer modes, terrain toggle, species panel
    const mmBefore = await evalJs(`document.querySelectorAll('canvas')[1]?.parentElement?.style.display`);
    check('minimap visible by default', mmBefore.value === 'block' || mmBefore.value === '', String(mmBefore.value));
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Minimap')?.click(); true`);
    await sleep(250);
    const mmAfter = await evalJs(`document.querySelectorAll('canvas')[1]?.parentElement?.style.display`);
    check('minimap hides on toggle', mmAfter.value === 'none', String(mmAfter.value));
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Minimap')?.click(); true`);

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Height')?.click(); true`);
    await sleep(300);
    const heightActive = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText === 'Height' && b.className.includes('bg-indigo'))`);
    const mixShown = await evalJs(`[...document.querySelectorAll('input[type=range]')].some(i => i.min === '0' && i.max === '1')`);
    check('Height layer activates', heightActive.value === true && mixShown.value === true);
    const mixSet = await evalJs(`(() => {
      const s = document.querySelector('input[title="layer mix"]');
      if (!s) return JSON.stringify({ ok: false });
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(s, '0.75');
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return JSON.stringify({ ok: true });
    })()`);
    await sleep(350);
    const mixLabel = await evalJs(`(() => {
      const s = document.querySelector('input[title="layer mix"]');
      return JSON.stringify({ val: s?.value, label: s?.parentElement?.querySelector('span')?.textContent ?? '' });
    })()`);
    const mixR = JSON.parse(String(mixLabel.value ?? '{}')) as { val?: string; label?: string };
    check(
      'layer mix slider updates value',
      JSON.parse(String(mixSet.value ?? '{}')).ok === true && mixR.val === '0.75' && mixR.label === '75%',
      `value=${mixR.val} label=${mixR.label}`,
    );
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Fractal')?.click(); true`);

    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Terrain')?.click(); true`);
    await sleep(250);
    const terrainOff = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText === 'Terrain' && !b.className.includes('bg-emerald'))`);
    check('Terrain layer toggles off', terrainOff.value === true);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Terrain')?.click(); true`);

    const spOn = await evalJs(`/sp\\.\\d+/.test(document.body.innerText)`);
    const spDebug = await evalJs(`(() => { const t = document.body.innerText; return JSON.stringify({ hasWaiting: t.includes('waiting for population'), sp: (t.match(/sp\.[0-9]+/g) || []).slice(0, 4), speciesIdx: t.indexOf('Species') }); })()`);
    console.log('[debug] species', spDebug.value);
    check('Species panel shows populations', spOn.value === true);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Species')?.click(); true`);
    await sleep(300);
    const spOff = await evalJs(`!/sp\.\d+/.test(document.body.innerText)`);
    check('Species panel toggles off', spOff.value === true);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Species')?.click(); true`);

    // --- Lineage fetch (local worker path)
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Lineage'))?.click(); true`);
    await sleep(900);
    const linDebug = await evalJs(`(() => { const t = document.body.innerText; const i = t.indexOf('Genealogy'); return JSON.stringify({ hasGenealogy: i >= 0, hasHash: /#\\d+/.test(t), slice: t.slice(i, i + 160) }); })()`);
    console.log('[debug] lineage', linDebug.value);
    const linOk = await evalJs(`document.body.innerText.includes('Genealogy') && /#\\d+/.test(document.body.innerText)`);
    check('Lineage fetches tree', linOk.value === true);

    // --- Remaining god tools activate
    for (const tool of ['Seed food', 'Spawn', 'Freeze', 'Nuke']) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes(${JSON.stringify(tool)}))?.click(); true`);
      await sleep(200);
      const active = await evalJs(`[...document.querySelectorAll('button')].some(b => b.innerText.includes(${JSON.stringify(tool)}) && b.className.includes('bg-indigo'))`);
      check(`${tool} tool activates`, active.value === true);
    }

    // --- Sliders: brush size and tick rate labels react to input
    const brushSet = await evalJs(`(() => {
      const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '10' && i.max === '600');
      if (!input) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, '300');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    const brushLabel = await evalJs(`(() => {
      const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '10' && i.max === '600');
      return input?.parentElement?.querySelector('span.w-8')?.innerText ?? '';
    })()`);
    check('brush slider updates label', brushSet.value === true && brushLabel.value === '300', String(brushLabel.value));

    const tpsSet = await evalJs(`(() => {
      const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '1' && i.max === '120');
      if (!input) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, '60');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    const tpsLabel = await evalJs(`(() => {
      const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '1' && i.max === '120');
      return input?.parentElement?.querySelector('span.w-8')?.innerText ?? '';
    })()`);
    check('tps slider updates label', tpsSet.value === true && tpsLabel.value.includes('60'), String(tpsLabel.value));

    // Remote mode: spawn over the server (only if the backend is reachable)
    const serverUp = await fetch(`${APP.replace('5173', '8080')}/api/health`).then((r) => r.ok).catch(() => false);
    if (serverUp) {
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'New World')?.click(); true`);
      await sleep(300);
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Remote (Server)')?.click(); true`);
      await sleep(200);
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Spawn')?.click(); true`);
      await sleep(6000);
      const remoteAlive = await evalJs(`document.body.innerText`);
      const m = /Alive\s+(\d+)/.exec(String(remoteAlive.value ?? ''));
      check('remote world ticks (Alive > 0)', m !== null && Number(m[1]) > 0, m ? `alive=${m[1]}` : 'no Alive stat');

      // remote pause/resume through the full UI -> WS -> server -> UI loop
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '⏸')?.click(); true`);
      const remotePauseSynced = await waitForButton('▶', 5000);
      check('remote pause syncs UI to ▶', remotePauseSynced);
      await sleep(500);
      const rpt1 = await readTick();
      await sleep(800);
      const rpt2 = await readTick();
      check('remote pause freezes ticks', rpt1 !== null && rpt1 === rpt2, `t=${rpt1} -> ${rpt2}`);
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '▶')?.click(); true`);
      const remotePlaySynced = await waitForButton('⏸', 5000);
      check('remote resume syncs UI to ⏸', remotePlaySynced);
      await sleep(300);
      const rBase = Number(await readTick());
      const rAfter = Number.isFinite(rBase) ? await waitForTickIncrease(rBase, 8000) : null;
      check('remote resume resumes ticking', rAfter !== null && rAfter > rBase, `t=${rBase} -> ${rAfter}`);

      // --- Remote god tool: painting with Nuke actually kills everything (UI -> WS -> server -> UI)
      const readAlive = async (): Promise<number | null> => {
        const body = await evalJs(`document.body.innerText`);
        const m = /Alive\s+(\d+)/.exec(String(body.value ?? ''));
        return m ? Number(m[1]) : null;
      };
      const beforeAlive = await readAlive();
      await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Nuke'))?.click(); true`);
      await sleep(200);
      await evalJs(`(() => {
        const c = document.querySelector('canvas');
        if (!c) return false;
        const r = c.getBoundingClientRect();
        const ev = (t) => c.dispatchEvent(new PointerEvent(t, {
          bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1,
        }));
        ev('pointerdown'); ev('pointerup');
        return true;
      })()`);
      let afterAlive: number | null = null;
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        afterAlive = await readAlive();
        if (afterAlive !== null && afterAlive < 5) break;
      }
      check(
        'remote nuke tool kills all agents',
        beforeAlive !== null && afterAlive !== null && afterAlive < 5,
        `alive ${beforeAlive} -> ${afterAlive}`,
      );

      // --- Diagnostic: is the browser's WS still connected after the nuke?
      const badge = await evalJs(`(() => {
        const t = document.body.innerText;
        return JSON.stringify({ remote: t.includes('REMOTE'), local: t.includes('LOCAL'), offline: t.includes('OFFLINE') });
      })()`);
      console.log('[browser] connected badge after nuke', badge.value);
      const badgeR = JSON.parse(String(badge.value ?? '{}')) as { remote?: boolean; offline?: boolean };
      check('remote session badge shows REMOTE', badgeR.remote === true, String(badge.value));

      // --- Remote tick-rate slider actually changes the server cadence. The DOM
      // stats/tick signals are throttled (every 30 ticks) so at 1tps they would
      // take 30s to refresh — measure the authoritative server tick instead.
      const apiBase = APP.replace('5173', '8080');
      const worldList = await fetch(`${apiBase}/api/worlds`).then((r) => r.json()).catch(() => null);
      const worldsArr = Array.isArray(worldList) ? (worldList as { id?: string; createdAt?: number }[]) : [];
      const rid = worldsArr.length > 0 ? [...worldsArr].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]!.id : null;
      console.log('[browser] rate-check world', rid);
      const readServerTick = async (): Promise<number | null> => {
        if (!rid) return null;
        try {
          const w = await fetch(`${apiBase}/api/worlds/${rid}`).then((r) => r.json());
          return typeof (w as { currentTick?: unknown }).currentTick === 'number' ? (w as { currentTick: number }).currentTick : null;
        } catch {
          return null;
        }
      };
      const setTpsSlider = async (val: string): Promise<boolean> => {
        const r = await evalJs(`(() => {
          const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '1' && i.max === '120');
          if (!input) return false;
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          set.call(input, ${JSON.stringify(val)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        return r.value === true;
      };
      await setTpsSlider('1');
      await sleep(2500);
      const slowA = await readServerTick();
      await sleep(6000);
      const slowB = await readServerTick();
      check(
        'remote tick-rate slider slows the server',
        slowA !== null && slowB !== null && slowA > 0 && slowB - slowA <= 12,
        `server tick advanced ${slowA} -> ${slowB} in 6s (target 1tps)`,
      );
      await setTpsSlider('60');
      await sleep(1000);
      const fastC = await readServerTick();
      check(
        'remote tick-rate slider speeds the server back up',
        fastC !== null && slowB !== null && fastC - slowB > 12,
        `server tick advanced ${slowB} -> ${fastC} in 1s (target 60tps)`,
      );
      // clean up the remote world so runs don't accumulate server-side
      if (rid) {
        await fetch(`${apiBase}/api/worlds/${rid}`, { method: 'DELETE' }).catch(() => undefined);
        console.log('[browser] deleted remote world', rid);
      }
    } else {
      console.log('[check] SKIP remote world (no server on :8080)');
    }

    // --- Spawn tool respects maxPopulation: spawn a tiny LOCAL world, then
    // --- paint the Spawn tool far more times than the cap allows and assert
    // --- the alive count never exceeds it. (The engine unit test covers the
    // --- cap; this covers the full UI -> worker -> engine path with real paints.)
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'New World')?.click(); true`);
    await sleep(300);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Local (Worker)')?.click(); true`);
    await sleep(200);
    const setModalSlider = async (min: string, max: string, val: string): Promise<boolean> => {
      const r = await evalJs(`(() => {
        const input = [...document.querySelectorAll('input[type=range]')].find(i => i.min === '${min}' && i.max === '${max}');
        if (!input) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(input, '${val}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      return r.value === true;
    };
    const foundersSet = await setModalSlider('10', '4000', '10');
    const maxPopSet = await setModalSlider('100', '12000', '100');
    // keep the tiny world stable for the alive poll: slow metabolism + generous food
    const metabSet = await setModalSlider('0.1', '4', '0.1');
    const foodSet = await setModalSlider('0', '0.005', '0.001');
    await sleep(200);
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === 'Spawn')?.click(); true`);
    await sleep(3500);

    const readCapAlive = async (): Promise<number | null> => {
      const body = await evalJs(`document.body.innerText`);
      const m = /Alive\s+(\d+)/.exec(String(body.value ?? ''));
      return m ? Number(m[1]) : null;
    };
    const capBefore = await readCapAlive();
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Spawn'))?.click(); true`);
    await sleep(200);
    const painted = await evalJs(`(() => {
      const c = document.querySelector('canvas');
      if (!c) return 0;
      const r = c.getBoundingClientRect();
      let n = 0;
      for (let i = 0; i < 150; i++) {
        const x = r.left + r.width * (0.15 + (0.7 * (i % 10)) / 9);
        const y = r.top + r.height * (0.15 + (0.7 * Math.floor(i / 10)) / 14);
        c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 100 + i }));
        c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 100 + i }));
        n++;
      }
      return n;
    })()`);
    let capAlive: number | null = null;
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      capAlive = await readCapAlive();
      if (capAlive !== null && capAlive >= 95) break;
    }
    check(
      'spawn tool respects maxPopulation (e2e)',
      foundersSet && maxPopSet && metabSet && foodSet && painted.value === 150 && capBefore !== null && capAlive !== null && capAlive <= 100 && capAlive >= 60,
      `alive ${capBefore} -> ${capAlive} after ${String(painted.value)} spawn paints (maxPopulation 100, sliders set: ${foundersSet && maxPopSet && metabSet && foodSet})`,
    );

    // Close modal if still open, check no fatal overlay
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText === '✕')?.click(); true`);
    await sleep(300);

    console.log('[browser] console samples', logs.slice(0, 6));
    console.log('[browser] errors', errors.length);
    for (const e of errors) console.log('[browser]', e);

    const fatal = errors.length > 0;
    const pass = checks.every((c) => c.pass) && !fatal && !sawException;
    console.log('[browser] RESULT', pass ? 'PASS' : 'FAIL', { checks: `${checks.filter((c) => c.pass).length}/${checks.length}`, errors: errors.length, sawException });
    ws.close();
    child.kill();
    if (!pass) process.exitCode = 1;
  } catch (err) {
    console.error('[browser] fatal', err);
    child.kill();
    process.exitCode = 1;
  }
}

void main();
