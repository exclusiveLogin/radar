import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const providers = await c.query(`
  SELECT id, key, title, status, adapter_kind, last_heartbeat_at, last_error, updated_at
  FROM ingest_providers ORDER BY key
`);
console.log("=== ingest_providers ===");
console.table(providers.rows);

const bindings = await c.query(`
  SELECT ib.id, ib.binding_key, ib.enabled, ib.binding_mode,
         ch.key AS channel_key, ch.telegram_target, ch.enabled AS channel_enabled,
         ip.key AS provider_key, ip.status AS provider_status
  FROM ingest_bindings ib
  JOIN ingest_providers ip ON ip.id = ib.provider_id
  LEFT JOIN channels ch ON ch.id = ib.channel_id
  ORDER BY ip.key, ch.key
`);
console.log("\n=== bindings ===");
console.table(bindings.rows);

const rvk = await c.query(`
  SELECT rm.posted_at, rm.fetched_at, rm.ingest_mode, LEFT(rm.raw_text, 120) AS text
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  WHERE ch.key ILIKE '%rvk%' OR ch.telegram_target ILIKE '%radar_rvk%'
  ORDER BY rm.posted_at DESC LIMIT 15
`);
console.log("\n=== radar_rvk raw_messages (all) ===");
console.table(rvk.rows);

const cursors = await c.query(`
  SELECT ic.*, ch.key AS channel_key
  FROM ingest_cursors ic
  LEFT JOIN channels ch ON ch.id = ic.channel_id
`);
console.log("\n=== ingest_cursors (live) ===");
console.table(cursors.rows);

const jobs = await c.query(`
  SELECT id, status, strategy, created_at, updated_at, last_error
  FROM ingest_backfill_jobs ORDER BY updated_at DESC LIMIT 5
`);
console.log("\n=== backfill jobs ===");
console.table(jobs.rows);

await c.end();
