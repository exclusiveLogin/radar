import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const rsa = await c.query(`
  SELECT region_code, state_level, self_level, activity, updated_at, reason
  FROM region_state_active
  WHERE region_code IN ('RU-PRI', 'RU-DON', 'RU-KDA')
`);

console.log("region_state_active:");
console.table(rsa.rows);

const priLocs = await c.query(`
  SELECT COUNT(*)::int AS cnt FROM event_locations el
  JOIN regions r ON r.id = el.region_id
  WHERE r.iso = 'RU-PRI'
`);
console.log("event_locations с RU-PRI сейчас:", priLocs.rows[0]?.cnt);

await c.end();
