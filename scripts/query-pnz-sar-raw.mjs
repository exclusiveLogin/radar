import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const raw = await c.query(`
  SELECT rm.id, rm.posted_at, LEFT(rm.raw_text, 120) AS text_preview,
         pa.status AS parse_status
  FROM raw_messages rm
  LEFT JOIN LATERAL (
    SELECT status FROM parse_attempts WHERE raw_message_id = rm.id ORDER BY created_at DESC LIMIT 1
  ) pa ON true
  WHERE rm.raw_text ILIKE '%пенз%' OR rm.raw_text ILIKE '%сарат%'
  ORDER BY rm.posted_at DESC LIMIT 12
`);
console.log("=== recent raw_messages (пенз/сарат) ===");
console.table(raw.rows);

const sync = await c.query(`
  SELECT region_code, state_level, self_level, activity, updated_at
  FROM region_state_active
  WHERE region_code IN ('RU-PNZ','RU-SAR')
`);
console.log("\n=== region_state_active NOW ===");
console.table(sync.rows);

const msgId = "7eb6f627-b05b-4daa-b4ad-90c0bf0b166d";
const pe = await c.query(
  "SELECT id, event_type, parsed_at FROM parsed_events WHERE raw_message_id = $1",
  [msgId],
);
console.log("\n=== parsed for 05:22 отбой msg ===");
console.table(pe.rows);
const locs = await c.query(
  `SELECT r.iso FROM event_locations el
   JOIN regions r ON r.id = el.region_id
   JOIN parsed_events p ON p.id = el.parsed_event_id
   WHERE p.raw_message_id = $1`,
  [msgId],
);
console.log("locations:", locs.rows.map((r) => r.iso));

await c.end();
