import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const codes = ["RU-PNZ", "RU-SAR"];
for (const code of codes) {
  const reg = await c.query(
    "SELECT id, iso, name, is_active FROM regions WHERE iso = $1",
    [code],
  );
  const rsa = await c.query(
    "SELECT region_code, state_level, self_level, activity, updated_at, reason FROM region_state_active WHERE region_code = $1",
    [code],
  );
  const hist = await c.query(
    `SELECT state_level, changed_at, reason FROM region_state_history
     WHERE region_code = $1 ORDER BY changed_at DESC LIMIT 5`,
    [code],
  );
  const ev = await c.query(
    `SELECT COUNT(*)::int AS cnt FROM event_locations el
     JOIN regions r ON r.id = el.region_id WHERE r.iso = $1`,
    [code],
  );
  const parsed = await c.query(
    `SELECT COUNT(*)::int AS cnt FROM event_locations el
     JOIN regions r ON r.id = el.region_id
     JOIN parsed_events pe ON pe.id = el.parsed_event_id
     WHERE r.iso = $1 AND pe.parsed_at > NOW() - INTERVAL '24 hours'`,
    [code],
  );

  console.log(`\n=== ${code} ===`);
  console.log("region:", reg.rows[0] ?? "NOT IN DB");
  console.log("region_state_active:", rsa.rows[0] ?? "NONE (grey/default)");
  console.log("history last 5:");
  console.table(hist.rows);
  console.log("event_locations total:", ev.rows[0]?.cnt);
  console.log("event_locations last 24h:", parsed.rows[0]?.cnt);
}

const recent = await c.query(`
  SELECT pe.parsed_at, pe.event_type, r.iso, el.precision, p.name AS place
  FROM parsed_events pe
  JOIN event_locations el ON el.parsed_event_id = pe.id
  JOIN regions r ON r.id = el.region_id
  LEFT JOIN places p ON p.id = el.place_id
  WHERE r.iso IN ('RU-PNZ','RU-SAR')
  ORDER BY pe.parsed_at DESC LIMIT 10
`);
console.log("\n=== recent parsed_events ===");
console.table(recent.rows);

await c.end();
