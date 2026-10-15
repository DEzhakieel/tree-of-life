import type { WorldConfig, WorldStatus, SimEvent } from '@fractal-life/shared';

export interface StoredSnapshot {
  tick: number;
  stateHash: number;
  /** binary SNAPSHOT frame (MT.SNAPSHOT) */
  data: Uint8Array;
}

export interface AgentRecord {
  simId: number;
  parentSimId: number;
  genome: Float32Array;
  bornAtTick: number;
  diedAtTick: number | null;
  finalFitness: number;
  alive: boolean;
}

export interface Storage {
  saveWorld(world: WorldConfig): Promise<void>;
  updateWorldTick(worldId: string, tick: number): Promise<void>;
  saveSnapshot(worldId: string, snap: StoredSnapshot): Promise<void>;
  getSnapshot(worldId: string, tick: number): Promise<StoredSnapshot | null>;
  getLatestSnapshot(worldId: string): Promise<StoredSnapshot | null>;
  listWorlds(): Promise<WorldConfig[]>;
  getWorld(worldId: string): Promise<WorldConfig | null>;
  saveEvents(worldId: string, events: SimEvent[]): Promise<void>;
  listEvents(worldId: string): Promise<SimEvent[]>;
  saveAgents(worldId: string, agents: AgentRecord[]): Promise<void>;
  listAgents(worldId: string): Promise<AgentRecord[]>;
  deleteWorld?(worldId: string): Promise<void>;
}
