import pg from "pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

console.log("=== raw_messages с «николаев» ===\n");
const raw = await client.query(`
  SELECT id, posted_at, left(replace(raw_text, E'\\n', ' | '), 240) AS snippet
  FROM raw_messages
  WHERE lower(raw_text) LIKE '%николаев%'
  ORDER BY posted_at DESC
  LIMIT 20
`);
for (const r of raw.rows) {
  console.log(`${r.posted_at?.toISOString?.() ?? r.posted_at}  ${r.id}`);
  console.log(`  ${r.snippet}\n`);
}

console.log("=== place_status_active / places «николаев» ===\n");
const places = await client.query(`
  SELECT p.id, p.name, p.centroid_lat, p.centroid_lon, r.iso, r.name AS region,
         psa.status_code, psa.updated_at
  FROM place_status_active psa
  JOIN places p ON p.id = psa.place_id
  JOIN regions r ON r.id = p.region_id
  WHERE lower(p.name) LIKE '%николаев%'
  ORDER BY psa.updated_at DESC
  LIMIT 15
`);
console.table(places.rows);

console.log("=== event_locations + raw snippet ===\n");
const el = await client.query(`
  SELECT rm.id AS raw_id, rm.posted_at, r.iso, p.name AS place,
         left(replace(rm.raw_text, E'\\n', ' '), 160) AS snippet
  FROM event_locations el
  JOIN parsed_events pe ON pe.id = el.parsed_event_id
  JOIN raw_messages rm ON rm.id = pe.raw_message_id
  JOIN regions r ON r.id = el.region_id
  LEFT JOIN places p ON p.id = el.place_id
  WHERE lower(COALESCE(p.name, '')) LIKE '%николаев%'
     OR (lower(rm.raw_text) LIKE '%николаев%' AND el.place_id IS NOT NULL)
  ORDER BY rm.posted_at DESC
  LIMIT 15
`);
for (const r of el.rows) {
  console.log(`${r.posted_at?.toISOString?.() ?? r.posted_at}  ${r.iso}  ${r.place}`);
  console.log(`  raw: ${r.raw_id}`);
  console.log(`  ${r.snippet}\n`);
}

const placeId = "1e41180e-9f0c-4eb5-b12e-0956abec84fc";
console.log("=== place detail ===\n");
const detail = await client.query(
  `
  SELECT p.*, r.iso, r.name AS region
  FROM places p
  JOIN regions r ON r.id = p.region_id
  WHERE p.id = $1
`,
  [placeId],
);
console.table(detail.rows);

console.log("=== place_evidence ===\n");
const ev = await client.query(
  `SELECT provider, action, payload, created_at FROM place_evidence WHERE place_id = $1 ORDER BY created_at DESC LIMIT 10`,
  [placeId],
);
console.log(ev.rows);

console.log("=== place_aliases ===\n");
const al = await client.query(`SELECT * FROM place_aliases WHERE place_id = $1`, [placeId]);
console.log(al.rows);

await client.end();
