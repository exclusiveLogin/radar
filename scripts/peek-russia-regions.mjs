import fs from "node:fs";
import { repoDataPath } from "../packages/api/dist/monorepo-root.js";

const p = repoDataPath(
  "geo",
  "artifacts",
  "boundaries",
  "Russia_geojson_OSM",
  "GeoJson's",
  "Countries",
  "Russia_regions.geojson",
);
const j = JSON.parse(fs.readFileSync(p, "utf8"));
console.log("features", j.features?.length);
const sample = j.features?.[0]?.properties;
console.log("sample props keys", Object.keys(sample ?? {}));
const names = j.features?.map((x) => x.properties?.region).filter(Boolean);
console.log("with vor", names?.filter((n) => /ворон|voron/i.test(String(n))).slice(0, 5));
console.log("first 5", names?.slice(0, 5));
