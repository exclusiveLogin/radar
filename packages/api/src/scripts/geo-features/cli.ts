/**
 * Импортирует структурную геометрию OSM → geo_feature + catalog place.
 * Запуск: npm run geo:features:import  (или geo:features:import -w @radar/api)
 *
 * Предусловие: geo:regions:seed уже выполнен (regions + places(kind=region) заполнены).
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import dataSource from "../../data-source";
import { OsmRussiaGeoImporter } from "../../application/geo-import/osm-russia-geo.importer";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function run(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  try {
    console.log("[geo:features:import] Запуск...");
    const importer = new OsmRussiaGeoImporter(dataSource);
    const stats = await importer.run();
    console.log("[geo:features:import] Готово:", JSON.stringify(stats, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
