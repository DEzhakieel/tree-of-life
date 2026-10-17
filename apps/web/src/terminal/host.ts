import {
  WORLD_SIZE,
  type SimStats,
  type TerminalHost,
} from '@fractal-life/shared';
import { useStore } from '../store/useStore.js';
import {
  buildLocalWorld,
  control,
  intervene,
  setTickRate,
  setTurbo,
  startSession,
} from '../net/session.js';

/**
 * In-browser {@link TerminalHost}: adapts the Zustand store + the session
 * command channel so the shared terminal commands drive the live dashboard.
 */
export function createWebHost(): TerminalHost {
  return {
    platform: 'web',

    describe() {
      const s = useStore.getState();
      return {
        platform: 'web',
        mode: s.mode,
        connected: s.connected,
        world: s.world?.id ?? null,
        seed: s.world?.seed ?? null,
        fractal: s.world?.fractalType ?? null,
        tick: s.stats?.tick ?? 0,
        population: s.stats?.population ?? 0,
        paused: s.paused,
        targetTickRate: s.targetTickRate,
        headless: s.headless,
      };
    },

    stats(): SimStats | null {
      return useStore.getState().stats;
    },

    params() {
      return { ...useStore.getState().formParams };
    },

    setParam(key, value) {
      const cur = useStore.getState().formParams as unknown as Record<string, unknown>;
      if (!(key in cur)) return false;
      (useStore.getState().setFormParam as (k: string, v: number) => void)(key, value);
      return true;
    },

    control(cmd) {
      control(cmd);
      useStore.getState().setPaused(cmd === 'pause');
    },

    step(n = 1) {
      for (let i = 0; i < n; i++) control('step');
    },

    reset() {
      const s = useStore.getState();
      const world = buildLocalWorld({
        seed: '',
        fractalType: s.formFractal,
        params: s.formParams,
      });
      s.clearStats();
      void startSession({ mode: s.mode, world });
    },

    spawn(count = 1) {
      const half = WORLD_SIZE / 2;
      const genome = useStore.getState().designGenome ?? undefined;
      for (let i = 0; i < count; i++) {
        intervene({ type: 'spawnAgent', x: half, y: half, genome });
      }
    },

    setTickRate(tps) {
      setTickRate(tps);
      useStore.getState().setTargetTickRate(tps);
    },

    setTurbo(on) {
      setTurbo(on);
    },

    exportState() {
      const s = useStore.getState();
      return {
        world: s.world,
        tick: s.stats?.tick ?? 0,
        paused: s.paused,
        params: s.formParams,
        stats: s.stats,
      };
    },
  };
}
