/**
 * Schema bootstrap for the Fractal Life Sandbox database.
 * Run `npm run db:migrate` with DATABASE_URL set (see infra/docker-compose.yml).
 */
import 'dotenv/config';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

const required = ['worlds', 'agents', 'snapshots', 'events', 'world_agents'];

const CREATE = {
  worlds: `
    CREATE TABLE IF NOT EXISTS worlds (
      id uuid PRIMARY KEY,
      seed text NOT NULL,
      fractal_type text NOT NULL CHECK (fractal_type IN ('mandelbrot','julia','perlin')),
      params jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      current_tick integer NOT NULL DEFAULT 0
    );`,
  agents: `
    CREATE TABLE IF NOT EXISTS agents (
      id uuid PRIMARY KEY,
      world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      sim_id integer NOT NULL,
      parent_sim_id integer NOT NULL DEFAULT -1,
      genome real[] NOT NULL,
      lineage text[] NOT NULL DEFAULT '{}',
      born_at_tick integer NOT NULL,
      died_at_tick integer,
      final_fitness double precision NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS agents_world_idx ON agents(world_id);
    CREATE INDEX IF NOT EXISTS agents_world_simid_idx ON agents(world_id, sim_id);`,
  snapshots: `
    CREATE TABLE IF NOT EXISTS snapshots (
      id serial PRIMARY KEY,
      world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      tick integer NOT NULL,
      state_hash bigint NOT NULL,
      data text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS snapshots_world_tick_idx ON snapshots(world_id, tick);`,
  events: `
    CREATE TABLE IF NOT EXISTS events (
      id serial PRIMARY KEY,
      world_id text NOT NULL,
      tick integer NOT NULL,
      type text NOT NULL CHECK (type IN ('extinction','cambrian','migration','symbiosis','famine','drought','war','birth','death','predation','discovery','intervention')),
      significance double precision NOT NULL DEFAULT 0,
      data jsonb NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_world_idx ON events(world_id);
    CREATE INDEX IF NOT EXISTS events_world_tick_idx ON events(world_id, tick);
    -- upgrades for databases created before the event-system expansion
    -- (world_id was uuid+FK to worlds; the type CHECK listed only 4 types).
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_world_id_fkey;
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'world_id' AND data_type <> 'text'
      ) THEN
        ALTER TABLE events ALTER COLUMN world_id TYPE text USING world_id::text;
      END IF;
    END $$;
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
    ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN ('extinction','cambrian','migration','symbiosis','famine','drought','war','birth','death','predation','discovery','intervention'));`,
  world_agents: `
    CREATE TABLE IF NOT EXISTS world_agents (
      id uuid PRIMARY KEY,
      world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      sim_id integer NOT NULL,
      parent_sim_id integer NOT NULL DEFAULT -1,
      genome real[] NOT NULL,
      born_at_tick integer NOT NULL,
      died_at_tick integer,
      final_fitness double precision NOT NULL DEFAULT 0,
      alive boolean NOT NULL DEFAULT true
    );
    CREATE INDEX IF NOT EXISTS world_agents_world_idx ON world_agents(world_id);`,
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Run: docker compose -f infra/docker-compose.yml up -d postgres');
    process.exit(1);
  }
  await bootstrapDatabase(url);
}

/** Idempotent schema bootstrap (CREATE TABLE IF NOT EXISTS). Also run at
 *  server startup when DATABASE_URL is set so fresh databases self-initialise. */
export async function bootstrapDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const name of required) {
      await client.query(CREATE[name as keyof typeof CREATE]);
      console.log(`  ok  ${name}`);
    }
  } finally {
    await client.end();
  }
  console.log('Schema is ready.');
}

// Run as a CLI only when invoked directly (npm run db:migrate), not when
// imported by the server for startup bootstrap (which runs bootstrapDatabase itself).
const isEntryPoint =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
