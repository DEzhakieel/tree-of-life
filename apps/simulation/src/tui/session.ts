import {
  DEFAULT_PARAMS,
  type SimStats,
  type TerminalHost,
  type WorldConfig,
} from '@fractal-life/shared';
import { Engine } from '../engine.js';

/**
 * Headless console session: owns a TS reference {@link Engine} and implements
 * the same {@link TerminalHost} contract as the browser, so the shared command
 * set drives both identically.
 */
export class ConsoleSession implements TerminalHost {
  readonly platform = 'console' as const;

  private engine: Engine;
  private seq = 0;
  private pendingSteps = 0;

  paused = false;
  turbo = false;
  tickRate: number;

  constructor(
    public seed: string = 'tol-console',
    tickRate = 30,
  ) {
    this.tickRate = tickRate;
    this.engine = this.build(this.seed);
  }

  private build(seed: string): Engine {
    const config: WorldConfig = {
      id: `console-${seed}`,
      seed,
      fractalType: 'mandelbrot',
      params: { ...DEFAULT_PARAMS },
      createdAt: Date.now(),
      currentTick: 0,
    };
    return new Engine(config);
  }

  get engineRef(): Engine {
    return this.engine;
  }

  /** One simulation step (also drains any queued `step` requests). */
  advance(): void {
    if (this.pendingSteps > 0) {
      this.pendingSteps--;
      this.engine.tick();
      return;
    }
    if (!this.paused) this.engine.tick();
  }

  describe(): Record<string, string | number | boolean | null> {
    const s = this.engine.stats();
    return {
      platform: 'console',
      backend: 'ts-reference',
      seed: this.seed,
      tick: s.tick,
      population: s.population,
      alive: s.aliveCount,
      species: s.speciesCount,
      paused: this.paused,
      turbo: this.turbo,
      tickRate: this.tickRate,
    };
  }

  stats(): SimStats {
    return this.engine.stats();
  }

  params(): Record<string, string | number | boolean> {
    return { ...(this.engine.params as unknown as Record<string, number>) };
  }

  setParam(key: string, value: number): boolean {
    const p = this.engine.params as unknown as Record<string, number>;
    if (!(key in p)) return false;
    p[key] = value;
    return true;
  }

  control(cmd: 'play' | 'pause' | 'step'): void {
    if (cmd === 'play') this.paused = false;
    else if (cmd === 'pause') this.paused = true;
    else this.pendingSteps++;
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) this.engine.tick();
  }

  reset(): void {
    this.engine = this.build(this.seed);
    this.paused = false;
    this.pendingSteps = 0;
  }

  spawn(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.engine.applyIntervention({
        type: 'spawnAgent',
        x: 1024,
        y: 1024,
        sequence: this.seq++,
      });
    }
  }

  setTickRate(tps: number): void {
    this.tickRate = tps;
  }

  setTurbo(on: boolean): void {
    this.turbo = on;
  }

  exportState(): unknown {
    const s = this.engine.stats();
    return {
      id: `console-${this.seed}`,
      seed: this.seed,
      tick: s.tick,
      paused: this.paused,
      params: this.engine.params,
      stats: s,
    };
  }
}
