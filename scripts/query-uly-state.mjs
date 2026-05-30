import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const r = await c.query(`
  SELECT region_code, state_level, self_level, activity, reason, updated_at
  FROM region_state_active
  WHERE region_code IN ('RU-ULY', 'RU-PNZ', 'RU-SAR')
  ORDER BY region_code
`);
console.log("=== region_state_active ===");
console.table(r.rows);

const h = await c.query(`
  SELECT region_code, state_level, previous_level, reason, changed_at
  FROM region_state_history
  WHERE region_code = 'RU-ULY'
  ORDER BY changed_at DESC
  LIMIT 10
`);
console.log("\n=== RU-ULY history ===");
console.table(h.rows);

const sd = await c.query(`
  SELECT code, state_level, label
  FROM status_dictionary
  WHERE code IN ('fixation', 'clear', 'attention', 'danger')
`);
console.log("\n=== status_dictionary ===");
console.table(sd.rows);

await c.end();
