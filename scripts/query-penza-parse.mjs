import pg from "pg";
import { config } from "dotenv";

config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const ids = [
  "1b702b24-02d3-48b6-8e9c-4fc40477a531",
  "6a639007-f6eb-4006-bca3-4a14443a6413",
];

for (const id of ids) {
  const pe = await c.query(
    "SELECT id, event_type, parsed_at FROM parsed_events WHERE raw_message_id = $1",
    [id],
  );
  const pa = await c.query(
    "SELECT status, errors, created_at FROM parse_attempts WHERE raw_message_id = $1 ORDER BY created_at DESC LIMIT 1",
    [id],
  );
  const rm = await c.query(
    "SELECT posted_at, ingest_mode FROM raw_messages WHERE id = $1",
    [id],
  );
  console.log("\n===", id, "===");
  console.log("raw:", rm.rows[0]);
  console.log("parsed_events:", pe.rows);
  console.log("parse_attempt:", pa.rows[0] ?? "NONE");
}

await c.end();
