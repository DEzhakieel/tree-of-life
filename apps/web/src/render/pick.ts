import type { AgentBuffer } from '../net/agentBuffer.js';

/** Click-to-inspect hit-box radius on screen (px). */
export const PICK_PX = 16;
/** Movement under which a pan is treated as a click (px). */
export const CLICK_SLOP_PX = 6;

/**
 * Nearest agent index within `radius` (world units) of a world-space point.
 * Returns -1 when nothing is in range. Scans the render buffer (alive agents
 * only — dead ones are filtered out at fill time).
 */
export function pickAgent(agents: AgentBuffer, wx: number, wy: number, radius: number): number {
  let best = -1;
  let bestD2 = radius * radius;
  for (let i = 0; i < agents.count; i++) {
    const dx = agents.x[i]! - wx;
    const dy = agents.y[i]! - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** World-space pick radius for a viewport height/zoom (span in world units). */
export function pickRadius(span: number, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return (PICK_PX * span) / viewportHeight;
}