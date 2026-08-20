/**
 * Диагностика identity place: Казань и политика уникальности (read-only).
 * Запуск: npx tsx src/scripts/geo-catalog/place-identity-analysis.ts
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import dataSource from "../../data-source";
import { normalizeName } from "../../application/geo-sync/diff-engine";
import { placeDraftKey } from "../../application/geo-sync/place-draft-key";
import { resolveGeoCatalogPath } from "../../infrastructure/geo-catalog/catalog-paths";
import { resolveFiasCatalogRegionCode } from "../../infrastructure/geo-providers/all-cities-fias/fiasRegionAliases";
import {
  mapFiasRowsToPlaceDrafts,
  parseAllCitiesFiasXlsx,
} from "../../infrastructure/geo-providers/all-cities-fias/parseAllCitiesFiasXlsx";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

async function run(): Promise<void> {
  const citiesPath = resolveGeoCatalogPath("tabular", "03_all_cities.xlsx");
  const rows = parseAllCitiesFiasXlsx(citiesPath);
  const drafts = mapFiasRowsToPlaceDrafts(rows);

  const tatStem = resolveFiasCatalogRegionCode("Татарстан");

  // --- Казань в xlsx ---
  const kazanRows = rows.filter((r) => normalizeName(r.city) === "казань");
  const kazanByRegion = new Map<string, number>();
  for (const row of kazanRows) {
    kazanByRegion.set(row.region, (kazanByRegion.get(row.region) ?? 0) + 1);
  }

  const kazanDrafts = drafts.filter((d) => normalizeName(d.name) === "казань");
  const kazanTat = kazanDrafts.filter((d) => d.regionCode === tatStem);

  const naturalGroups = new Map<string, typeof kazanDrafts>();
  for (const draft of kazanDrafts) {
    const key = `${draft.regionCode}:${draft.kind}`;
    const group = naturalGroups.get(key) ?? [];
    group.push(draft);
    naturalGroups.set(key, group);
  }

  console.log("=== XLSX: строки с city=Казань ===");
  console.log("total rows:", kazanRows.length);
  console.log("by FIAS region label:", Object.fromEntries(kazanByRegion));

  console.log("\n=== SNAPSHOT drafts: Казань ===");
  console.log("total drafts:", kazanDrafts.length);
  for (const [key, group] of naturalGroups) {
    console.log(`  ${key}: ${group.length} oktmo samples:`, group.slice(0, 3).map((d) => d.oktmo));
  }

  const tatXlsxRows = rows.filter(
    (row) => row.region === "Татарстан" && normalizeName(row.city) === "казань",
  );
  const rowsOktmo927 = rows.filter((row) => row.oktmo === "92701000");
  const draftsOktmo927 = drafts.filter((draft) => draft.oktmo === "92701000");

  console.log("\n=== Татарстан / Казань (канон города) ===");
  console.log("xlsx rows in Tatarstan:", JSON.stringify(tatXlsxRows, null, 2));
  console.log("drafts in Tatarstan:", kazanTat.length);
  for (const draft of kazanTat) {
    console.log({
      kind: draft.kind,
      oktmo: draft.oktmo,
      nameWithType: draft.nameWithType,
      snapshotKey: placeDraftKey(draft),
      naturalKey: `${draft.regionCode}:${draft.kind}:${normalizeName(draft.name)}`,
    });
  }
  console.log("all xlsx rows with oktmo=92701000:", rowsOktmo927.length);
  for (const row of rowsOktmo927.slice(0, 5)) {
    console.log({
      region: row.region,
      city: row.city,
      cityType: row.cityType,
      aoLevel: row.aoLevel,
      draftKey: placeDraftKey({
        regionCode: resolveFiasCatalogRegionCode(row.region),
        kind: row.cityType === "г" ? "city" : "locality",
        name: row.city,
        oktmo: row.oktmo,
      }),
    });
  }
  console.log("drafts with oktmo=92701000:", JSON.stringify(draftsOktmo927, null, 2));

  // Пример homonym collapse: одно имя+kind, разный oktmo
  const homonymSample = new Map<string, { oktmos: Set<string>; count: number }>();
  for (const draft of drafts) {
    const naturalKey = `${draft.regionCode}:${draft.kind}:${normalizeName(draft.name)}`;
    const entry = homonymSample.get(naturalKey) ?? { oktmos: new Set<string>(), count: 0 };
    if (draft.oktmo) entry.oktmos.add(draft.oktmo);
    entry.count += 1;
    homonymSample.set(naturalKey, entry);
  }
  const homonymGroups = [...homonymSample.entries()]
    .filter(([, v]) => v.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([key, v]) => ({ key, snapshotRows: v.count, uniqueOktmo: v.oktmos.size }));

  console.log("\n=== TOP homonym groups (region+kind+name, разный oktmo) ===");
  console.log(JSON.stringify(homonymGroups, null, 2));

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const dbKazan = await dataSource.query(`
      SELECT p.id, p.kind, p.name, p.oktmo, p.name_stem, p.geo_feature_id IS NOT NULL AS has_geo,
             r.iso, r.name AS region_name
      FROM places p
      JOIN regions r ON r.id = p.region_id
      WHERE p.is_active = true
        AND p.name_normalized = 'казань'
      ORDER BY r.iso, p.kind
    `);

    console.log("\n=== DB: places named Казань ===");
    console.log(JSON.stringify(dbKazan, null, 2));

    const dbTatKazan = dbKazan.filter((row: { iso: string }) => row.iso === "RU-TA");
    console.log("\nDB Казань в Татарстане:", dbTatKazan.length, "строк(и)");

    const geoKazan = await dataSource.query(`
      SELECT gf.id, gf.layer, gf.name, gf.name_stem, r.iso
      FROM geo_feature gf
      JOIN regions r ON r.id = gf.region_id
      WHERE gf.is_active = true
        AND gf.name_stem = 'казань'
      ORDER BY gf.layer
    `);
    console.log("\n=== geo_feature со stem=казань ===");
    console.log(JSON.stringify(geoKazan, null, 2));
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
