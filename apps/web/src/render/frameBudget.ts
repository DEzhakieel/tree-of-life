import { useStore } from '../store/useStore.js';

/**
 * True while the renderer must not draw.
 *
 * Headless mode (`TopBar` → store `headless`) runs the simulation unpaced with
 * `frameEvery: 0`, so the worker stops producing frames — but the render loops
 * are independent of the frame stream and would otherwise keep re-drawing the
 * last stale snapshot at 60fps, burning exactly the CPU headless is meant to
 * free. The loops call this every frame and return before any GPU/canvas work.
 *
 * They still reschedule their `requestAnimationFrame`, so the loop revives by
 * itself on the next frame after headless is switched off — no resume path is
 * needed here.
 */
export function frameSuspended(): boolean {
  return useStore.getState().headless;
}
