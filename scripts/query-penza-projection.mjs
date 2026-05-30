import pg from "pg";
import { config } from "dotenv";

config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const peIds = [
  "578f2196-24f8-4476-8689-d8bb274c9007",
  "fc655380-2710-4780-854d-af62fff19e4e",
];

for (const peId of peIds) {
  const locs = await c.query(
    `SELECT r.iso, el.precision, p.name AS place
     FROM event_locations el
     JOIN regions r ON r.id = el.region_id
     LEFT JOIN places p ON p.id = el.place_id
     WHERE el.parsed_event_id = $1`,
    [peId],
  );
  console.log("\npe", peId, "locations:", locs.rows);
}

const hist = await c.query(
  `SELECT region_code, state_level, changed_at, reason
   FROM region_state_history
   WHERE region_code IN ('RU-PNZ','RU-SAR')
   ORDER BY changed_at DESC LIMIT 8`,
);
console.log("\n=== history PNZ/SAR ===");
console.table(hist.rows);

await c.end();
