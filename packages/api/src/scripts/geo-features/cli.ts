/**
 * Legacy: только шаг osm_geometry. Предпочтительно geo:catalog:import.
 * Предусловие: tabular/frontline import уже выполнен (places в БД).
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
    console.warn(
      "[geo:features:import] deprecated — используйте npm run geo:catalog:import -w @radar/api",
    );
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
