import pg from "pg";
import { config } from "dotenv";
config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const msgId = "2d33dc86-7153-4f73-a595-2c7271e5cb64";

const channel = await c.query(`
  SELECT rm.id, rm.posted_at, rm.raw_text, ch.key AS channel_key, ch.title
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  WHERE rm.id = $1
`, [msgId]);
console.log("=== message + channel ===");
console.log(channel.rows[0]);

const timeline = await c.query(`
  SELECT pe.parsed_at, pe.event_type, r.iso
  FROM parsed_events pe
  JOIN event_locations el ON el.parsed_event_id = pe.id
  JOIN regions r ON r.id = el.region_id
  WHERE r.iso IN ('RU-PNZ','RU-SAR')
    AND pe.parsed_at >= '2026-05-29T21:00:00Z'
  ORDER BY pe.parsed_at ASC
`);
console.log("\n=== timeline PNZ/SAR after 21:00 May 29 ===");
console.table(timeline.rows);

const hist = await c.query(`
  SELECT state_level, changed_at, reason
  FROM region_state_history
  WHERE region_code IN ('RU-PNZ','RU-SAR')
    AND changed_at >= '2026-05-29T21:00:00Z'
    AND reason NOT LIKE 'reparse:%'
  ORDER BY changed_at ASC
`);
console.log("\n=== state history (no reparse noise) ===");
console.table(hist.rows);

const latest = await c.query(`
  SELECT rm.posted_at, ch.key, LEFT(rm.raw_text, 100) AS text
  FROM raw_messages rm
  JOIN channels ch ON ch.id = rm.channel_id
  WHERE ch.key = 'radar-pf'
  ORDER BY rm.posted_at DESC LIMIT 5
`);
console.log("\n=== last 5 from @Radarpf (radar-pf) ===");
console.table(latest.rows);

await c.end();
