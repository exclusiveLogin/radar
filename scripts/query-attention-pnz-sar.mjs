import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const raw = await c.query(`
  SELECT rm.id, rm.posted_at, LEFT(rm.raw_text, 200) AS text
  FROM raw_messages rm
  WHERE rm.raw_text ILIKE '%внимание по БПЛА%'
    AND rm.raw_text ILIKE '%сарат%'
    AND rm.raw_text ILIKE '%пенз%'
  ORDER BY rm.posted_at DESC LIMIT 8
`);
console.log("=== raw: внимание БПЛА сарат+пенз ===");
console.table(raw.rows);

if (raw.rows[0]) {
  const msgId = raw.rows[0].id;
  const pe = await c.query(
    `SELECT id, event_type, severity, parsed_at FROM parsed_events WHERE raw_message_id = $1`,
    [msgId],
  );
  console.log("\nparsed_events:", pe.rows);

  const locs = await c.query(
    `SELECT r.iso, el.precision, p.name AS place
     FROM event_locations el
     JOIN regions r ON r.id = el.region_id
     LEFT JOIN places p ON p.id = el.place_id
     JOIN parsed_events pe ON pe.id = el.parsed_event_id
     WHERE pe.raw_message_id = $1`,
    [msgId],
  );
  console.log("event_locations:", locs.rows);
}

const active = await c.query(`
  SELECT region_code, state_level, self_level, activity, updated_at, reason
  FROM region_state_active WHERE region_code IN ('RU-PNZ','RU-SAR')
`);
console.log("\nregion_state_active:");
console.table(active.rows);

const ch = await c.query(`
  SELECT ip.key, ip.title, ip.status, ib.external_id, ib.enabled
  FROM ingest_providers ip
  LEFT JOIN ingest_bindings ib ON ib.provider_id = ip.id
  WHERE ip.key ILIKE '%radar%' OR ip.title ILIKE '%radar%' OR ib.external_id ILIKE '%radarpf%'
`);
console.log("\ningest providers/bindings (radar):");
console.table(ch.rows);

await c.end();
