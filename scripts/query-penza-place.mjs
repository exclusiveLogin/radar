import pg from "pg";
import { config } from "dotenv";

config();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const places = await c.query(`
  SELECT p.id, p.name, p.kind, p.centroid_lat, p.centroid_lon, psa.status_code, psa.updated_at,
         r.iso, r.centroid_lat AS region_lat, r.centroid_lon AS region_lon
  FROM places p
  JOIN regions r ON r.id = p.region_id
  LEFT JOIN place_status_active psa ON psa.place_id = p.id
  WHERE r.iso = 'RU-PNZ' AND (p.name ILIKE 'Пенза%' OR p.name ILIKE '%Пенза%')
  ORDER BY p.kind
`);
console.log("=== Penza places ===");
console.table(places.rows);

const sd = await c.query(`SELECT code, state_level FROM status_dictionary WHERE code IN ('danger','attention')`);
console.log("\n=== status_dictionary ===");
console.table(sd.rows);

await c.end();
