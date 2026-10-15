import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  doublePrecision,
  serial,
  bigint,
  index,
} from 'drizzle-orm/pg-core';

export const worlds = pgTable('worlds', {
  id: uuid('id').primaryKey(),
  seed: text('seed').notNull(),
  fractalType: text('fractal_type', { enum: ['mandelbrot', 'julia', 'perlin'] }).notNull(),
  params: jsonb('params').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  currentTick: integer('current_tick').notNull().default(0),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey(),
  worldId: uuid('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
  simId: integer('sim_id').notNull(),
  parentSimId: integer('parent_sim_id').notNull().default(-1),
  genome: real('genome').array().notNull(),
  lineage: text('lineage').array().notNull().default([]),
  bornAtTick: integer('born_at_tick').notNull(),
  diedAtTick: integer('died_at_tick'),
  finalFitness: doublePrecision('final_fitness').notNull().default(0),
});

export const snapshots = pgTable('snapshots', {
  id: serial('id').primaryKey(),
  worldId: uuid('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
  tick: integer('tick').notNull(),
  stateHash: bigint('state_hash', { mode: 'number' }).notNull(),
  data: text('data').notNull(), // base64 of the binary snapshot frame
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  // opaque key (text): browser-local worlds log under `local-*` ids that are
  // never registered as server-side world rows, so there is no FK here
  worldId: text('world_id').notNull(),
  tick: integer('tick').notNull(),
  type: text('type', {
    enum: [
      'extinction',
      'cambrian',
      'migration',
      'symbiosis',
      'famine',
      'drought',
      'war',
      'birth',
      'death',
      'predation',
      'discovery',
      'intervention',
    ],
  }).notNull(),
  significance: doublePrecision('significance').notNull().default(0),
  data: jsonb('data').notNull().default({}),
}, (table) => ({
  worldTickIdx: index('events_world_tick_idx').on(table.worldId, table.tick),
}));

export const worldAgents = pgTable('world_agents', {
  id: uuid('id').primaryKey(),
  worldId: uuid('world_id').notNull().references(() => worlds.id, { onDelete: 'cascade' }),
  simId: integer('sim_id').notNull(),
  parentSimId: integer('parent_sim_id').notNull().default(-1),
  genome: real('genome').array().notNull(),
  bornAtTick: integer('born_at_tick').notNull(),
  diedAtTick: integer('died_at_tick'),
  finalFitness: doublePrecision('final_fitness').notNull().default(0),
  alive: boolean('alive').notNull().default(true),
});

export type WorldRow = typeof worlds.$inferSelect;
export type NewWorldRow = typeof worlds.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type EventRow = typeof events.$inferSelect;
