import pg from "pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log("=== raw_messages с «примор» в тексте ===\n");
const raw = await client.query(`
  SELECT id, posted_at, left(replace(raw_text, E'\\n', ' | '), 160) AS snippet
  FROM raw_messages
  WHERE lower(raw_text) LIKE '%примор%'
  ORDER BY posted_at DESC
`);
console.log(`Всего: ${raw.rowCount}\n`);
for (const r of raw.rows) {
  console.log(`${r.posted_at?.toISOString?.() ?? r.posted_at}  ${r.id}`);
  console.log(`  ${r.snippet}\n`);
}

console.log("=== region_state_active (не grey) для PRI / Приморский ===\n");
const rsa = await client.query(`
  SELECT rsa.region_code, rsa.state_level, rsa.self_level, rsa.activity, rsa.updated_at, r.name
  FROM region_state_active rsa
  JOIN regions r ON r.id = rsa.region_id
  WHERE rsa.region_code = 'RU-PRI' OR lower(r.name) LIKE '%приморский%'
`);
console.table(rsa.rows);

console.log("=== event_locations → RU-PRI (последние 20) ===\n");
const locs = await client.query(`
  SELECT rm.posted_at, r.iso AS region_code, el.precision,
         COALESCE(p.name, r.name) AS label,
         left(replace(rm.raw_text, E'\\n', ' '), 100) AS snippet
  FROM event_locations el
  JOIN parsed_events pe ON pe.id = el.parsed_event_id
  JOIN raw_messages rm ON rm.id = pe.raw_message_id
  JOIN regions r ON r.id = el.region_id
  LEFT JOIN places p ON p.id = el.place_id
  WHERE r.iso = 'RU-PRI'
  ORDER BY rm.posted_at DESC
  LIMIT 20
`);
console.log(`Строк: ${locs.rowCount}\n`);
for (const r of locs.rows) {
  console.log(
    `${r.posted_at?.toISOString?.() ?? r.posted_at}  ${r.region_code}  ${r.precision}  ${r.label}`,
  );
  console.log(`  ${r.snippet}\n`);
}

const mariupolId = "385b19ca-d435-4ec9-a059-3a05c480d816";
console.log("=== разбор raw «Приморский, ЖД Вокзал Мариуполь» ===\n");
const pe = await client.query(
  `SELECT id, event_type FROM parsed_events WHERE raw_message_id = $1`,
  [mariupolId],
);
console.log("parsed_events:", pe.rows);
if (pe.rows[0]) {
  const el = await client.query(
    `
    SELECT el.precision, r.iso, r.name AS region_name, p.name AS place_name
    FROM event_locations el
    JOIN regions r ON r.id = el.region_id
    LEFT JOIN places p ON p.id = el.place_id
    WHERE el.parsed_event_id = $1
  `,
    [pe.rows[0].id],
  );
  console.table(el.rows);
}

console.log("=== raw с «примор» но БЕЗ «ахтар» (возможный ложный PRI) ===\n");
const falsePri = await client.query(`
  SELECT id, posted_at, left(replace(raw_text, E'\\n', ' | '), 140) AS snippet
  FROM raw_messages
  WHERE lower(raw_text) LIKE '%примор%'
    AND lower(raw_text) NOT LIKE '%ахтар%'
  ORDER BY posted_at DESC
  LIMIT 15
`);
console.log(`Всего: ${falsePri.rowCount}\n`);
for (const r of falsePri.rows) {
  console.log(`${r.posted_at?.toISOString?.() ?? r.posted_at}  ${r.snippet}\n`);
}

await client.end();
