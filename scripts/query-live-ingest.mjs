import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const bindings = await c.query(`
  SELECT binding_key, external_target, binding_mode, enabled
  FROM ingest_bindings ORDER BY binding_key
`);
console.log("=== bindings external_target ===");
console.table(bindings.rows);

const live = await c.query(`
  SELECT COUNT(*)::int AS n FROM raw_messages WHERE ingest_mode = 'live'
`);
console.log("\nlive raw_messages:", live.rows[0].n);

const recent = await c.query(`
  SELECT rm.ingest_mode, rm.fetched_at, rm.posted_at, ch.key AS channel_key,
         LEFT(rm.raw_text, 80) AS text
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  ORDER BY rm.fetched_at DESC LIMIT 8
`);
console.log("\n=== last fetched ===");
console.table(recent.rows);

const cursors = await c.query(`SELECT COUNT(*)::int AS n FROM ingest_cursors`);
console.log("\ningest_cursors count:", cursors.rows[0].n);

await c.end();
