export * from './constants.js';
export * from './types.js';
export * from './universe.js';
export * from './zodSchemas.js';
export * from './worldConfig.js';
export * from './grounding.js';
export * from './genomeBlueprint.js';
export * from './eventSink.js';
export * from './emergenceAtlas.js';
export * from './emergenceRadar.js';
export * from './lifeOrganization.js';
export * from './criticalTransitions.js';
export * from './experiments.js';
export * from './protocol/binary.js';
export * from './protocol/hash.js';
export * from './terminal/index.js';

/** Client -> server JSON control messages over the WS gateway. */
export interface ClientJoinMessage {
  op: 'join';
  worldId: string;
  clientId: string;
}

export interface ClientInterveneMessage {
  op: 'intervene';
  worldId: string;
  intervention: import('./types.js').Intervention;
}

export interface ClientControlMessage {
  op: 'play' | 'pause' | 'step';
  worldId: string;
}

export interface ClientSnapshotRequest {
  op: 'snapshot';
  worldId: string;
  tick?: number;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInterveneMessage
  | ClientControlMessage
  | ClientSnapshotRequest;
