import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.join(process.cwd(), "../../.env") });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const msgId = "bdcec55a-4d7c-4ee8-8b52-6d4c6d6bebed";

const pe = await client.query(`
  SELECT pe.id, pe.event_type, pe.is_active
  FROM parsed_events pe WHERE pe.raw_message_id = $1
`, [msgId]);

const locs = await client.query(`
  SELECT el.precision, el.entity_kind, el.action, el.status_code,
         el.lat, el.lon, el.scope_radius_m, p.name AS place_name
  FROM event_locations el
  LEFT JOIN places p ON p.id = el.place_id
  WHERE el.parsed_event_id IN (SELECT id FROM parsed_events WHERE raw_message_id = $1)
  ORDER BY el.precision, p.name NULLS LAST
`, [msgId]);

const ws = await client.query(`
  SELECT spawned_event_ids, candidate_event_map
  FROM message_parse_workspace
  WHERE raw_message_id = $1
  ORDER BY created_at DESC LIMIT 1
`, [msgId]);

console.log("parsed_events:", JSON.stringify(pe.rows, null, 2));
console.log("locations:", JSON.stringify(locs.rows, null, 2));
console.log("workspace:", JSON.stringify(ws.rows[0], null, 2));

await client.end();
