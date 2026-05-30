import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const q = await c.query(`
  SELECT rm.posted_at, rm.fetched_at, rm.ingest_mode, ch.key,
         LEFT(rm.raw_text, 120) AS text
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  WHERE ch.key = 'radar-russia'
     OR rm.raw_text ILIKE '%Россош%'
     OR rm.raw_text ILIKE '%Кантемир%'
  ORDER BY rm.fetched_at DESC
  LIMIT 10
`);
console.table(q.rows);

const live = await c.query(
  `SELECT COUNT(*)::int AS n FROM raw_messages WHERE ingest_mode = 'live'`,
);
console.log("live total:", live.rows[0].n);

await c.end();
