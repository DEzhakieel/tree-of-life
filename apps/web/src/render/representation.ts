import type { AgentBuffer } from '../net/agentBuffer.js';
import type { LineageNode } from '@fractal-life/shared';

export interface Edge {
  /** row index into the AgentBuffer */
  a: number;
  b: number;
  kind: 'lineage' | 'proximity';
}

/** Flatten the nested lineage tree into id -> parentId, for O(1) parent lookup. */
export function lineageParents(nodes: readonly LineageNode[] | null): Map<number, number> {
  const out = new Map<number, number>();
  if (!nodes) return out;
  const walk = (list: readonly LineageNode[]): void => {
    for (const n of list) {
      if (n.parentId >= 0 && n.id >= 0) out.set(n.id, n.parentId);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Edges for the network view. Proximity edges join agents inside `radius`
 * world units, capped so a dense clump cannot produce a quadratic edge dump;
 * lineage edges join a live agent to its parent when the parent is also in
 * this frame.
 */
export function buildEdges(agents: AgentBuffer, radius: number, maxEdges = 4000): Edge[] {
  const edges: Edge[] = [];
  const n = agents.count;
  const r2 = radius * radius;
  const perAgentCap = Math.max(1, Math.floor(maxEdges / Math.max(1, n)));

  // Uniform spatial hash over the world so the neighbour scan stays near
  // O(n) instead of O(n^2) when the population is spread out.
  const cell = radius;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number): string => `${cx},${cy}`;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(agents.x[i]! / cell);
    const cy = Math.floor(agents.y[i]! / cell);
    const k = key(cx, cy);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  for (let i = 0; i < n && edges.length < maxEdges; i++) {
    const cx = Math.floor(agents.x[i]! / cell);
    const cy = Math.floor(agents.y[i]! / cell);
    let added = 0;
    for (let dx = -1; dx <= 1 && added < perAgentCap; dx++) {
      for (let dy = -1; dy <= 1 && added < perAgentCap; dy++) {
        const bucket = grid.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i || added >= perAgentCap || edges.length >= maxEdges) continue;
          const ddx = agents.x[i]! - agents.x[j]!;
          const ddy = agents.y[i]! - agents.y[j]!;
          if (ddx * ddx + ddy * ddy <= r2) {
            edges.push({ a: i, b: j, kind: 'proximity' });
            added++;
          }
        }
      }
    }
  }
  return edges;
}

/** Lineage edges restricted to agents present in this frame. */
export function buildLineageEdges(
  agents: AgentBuffer,
  parents: Map<number, number>,
): Edge[] {
  const rowById = new Map<number, number>();
  for (let i = 0; i < agents.count; i++) rowById.set(agents.id[i]!, i);
  const edges: Edge[] = [];
  for (let i = 0; i < agents.count; i++) {
    const parentRow = rowById.get(parents.get(agents.id[i]!) ?? -1);
    if (parentRow !== undefined && parentRow !== i) edges.push({ a: i, b: parentRow, kind: 'lineage' });
  }
  return edges;
}

export interface LatticeGrid {
  cols: number;
  rows: number;
  cell: number;
  /** per-cell population count */
  count: Int32Array;
  /** per-cell summed energy */
  energy: Float32Array;
  /** per-cell summed meme, for culture tinting */
  meme: Float32Array;
}

/**
 * Bin agents into a `cell` world-unit grid. This is the data behind the
 * lattice view — the renderer just colourises it.
 */
export function buildLattice(agents: AgentBuffer, worldSize: number, cell: number): LatticeGrid {
  const cols = Math.max(1, Math.ceil(worldSize / cell));
  const rows = cols;
  const count = new Int32Array(cols * rows);
  const energy = new Float32Array(cols * rows);
  const meme = new Float32Array(cols * rows);
  for (let i = 0; i < agents.count; i++) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(agents.x[i]! / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(agents.y[i]! / cell)));
    const idx = cy * cols + cx;
    count[idx] = count[idx]! + 1;
    energy[idx] = energy[idx]! + agents.energy[i]!;
    meme[idx] = meme[idx]! + agents.meme[i]!;
  }
  return { cols, rows, cell, count, energy, meme };
}

/** Pick a lattice cell size that keeps the grid legible (roughly 48 cells
 *  across the world) rather than one cell per agent. */
export function latticeCellSize(worldSize: number): number {
  return worldSize / 48;
}
