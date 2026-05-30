import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const last = await c.query(`
  SELECT
    rm.id,
    rm.posted_at,
    rm.fetched_at,
    rm.provider_key,
    rm.ingest_mode,
    ch.key AS channel_key,
    ch.title AS channel_title,
    ch.telegram_target,
    rm.raw_text
  FROM raw_messages rm
  LEFT JOIN channels ch ON ch.id = rm.channel_id
  ORDER BY rm.posted_at DESC NULLS LAST
  LIMIT 1
`);

console.log("=== последнее raw_message (по posted_at) ===");
if (last.rows[0]) {
  const r = last.rows[0];
  console.log("posted_at:      ", r.posted_at);
  console.log("fetched_at (БД):", r.fetched_at);
  console.log("channel:        ", r.channel_key, "—", r.channel_title);
  console.log("telegram:       ", r.telegram_target);
  console.log("provider_key:   ", r.provider_key);
  console.log("ingest_mode:    ", r.ingest_mode);
  console.log("id:             ", r.id);
  console.log("\ntext:\n", r.raw_text);
} else {
  console.log("(нет записей)");
}

const lastFetched = await c.query(`
  SELECT rm.posted_at, rm.fetched_at, ch.key, ch.telegram_target, LEFT(rm.raw_text, 100) AS preview
  FROM raw_messages rm
  LEFT JOIN channels ch ON ch.id = rm.channel_id
  ORDER BY rm.fetched_at DESC NULLS LAST
  LIMIT 5
`);
console.log("\n=== последние 5 по fetched_at (когда попало в БД) ===");
console.table(lastFetched.rows);

const lastLive = await c.query(`
  SELECT rm.posted_at, rm.fetched_at, ch.key, ch.telegram_target, rm.raw_text
  FROM raw_messages rm
  LEFT JOIN channels ch ON ch.id = rm.channel_id
  WHERE rm.ingest_mode = 'live'
  ORDER BY rm.posted_at DESC NULLS LAST
  LIMIT 1
`);
console.log("\n=== последнее LIVE (реальный ingest) ===");
if (lastLive.rows[0]) {
  const r = lastLive.rows[0];
  console.log("posted_at: ", r.posted_at);
  console.log("fetched_at:", r.fetched_at);
  console.log("channel:   ", r.key, r.telegram_target);
  console.log("text:\n", r.raw_text);
} else {
  console.log("(нет live-сообщений)");
}

const modes = await c.query(`
  SELECT ingest_mode, COUNT(*)::int AS cnt FROM raw_messages GROUP BY ingest_mode
`);
console.log("\n=== ingest_mode stats ===");
console.table(modes.rows);

const pf = await c.query(`
  SELECT rm.posted_at, rm.fetched_at, rm.ingest_mode, LEFT(rm.raw_text, 100) AS text
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  WHERE ch.key = 'radar-pf'
  ORDER BY rm.posted_at DESC LIMIT 3
`);
console.log("\n=== last 3 @Radarpf ===");
console.table(pf.rows);

await c.end();
