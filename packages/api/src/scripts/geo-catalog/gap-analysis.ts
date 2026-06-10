/**
 * Анализ причин gap snapshot vs DB и geo orphans (read-only).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import dataSource from "../../data-source";
import { resolveGeoCatalogPath } from "../../infrastructure/geo-catalog/catalog-paths";
import {
  isFiasImportableRow,
  mapFiasRowsToPlaceDrafts,
  parseAllCitiesFiasXlsx,
} from "../../infrastructure/geo-providers/all-cities-fias/parseAllCitiesFiasXlsx";
import {
  buildRegionIndex,
  resolveRegionFromIndex,
} from "../../application/geo-sync/geo-sync-region-index";
import type { RegionRecord } from "@radar/shared";
import { normalizeName } from "../../application/geo-sync/diff-engine";
import { resolvePlaceIdentityKey } from "@radar/shared";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

function loadRegionRows(): RegionRecord[] {
  const regionsPath = resolveGeoCatalogPath("tabular", "regions.json");
  const raw = JSON.parse(fs.readFileSync(regionsPath, "utf8").replace(/^\uFEFF/, "")) as Array<{
    iso: string;
    name: string;
    nameWithType?: string;
    shortName?: string;
    fiasId?: string | null;
    kladrId?: string | null;
    frontRegion?: boolean;
    borderRegion?: boolean;
  }>;
  return raw.map((entry, index) => ({
    id: `r-${index}`,
    code: entry.iso ?? entry.name,
    iso: entry.iso,
    name: entry.name,
    nameWithType: entry.nameWithType,
    shortName: entry.shortName,
    fiasId: entry.fiasId ?? undefined,
    kladrId: entry.kladrId ?? undefined,
    frontRegion: entry.frontRegion ?? false,
    borderRegion: entry.borderRegion ?? false,
  }));
}

async function run(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const regionRows = loadRegionRows();
    const index = buildRegionIndex(regionRows);
    const citiesPath = resolveGeoCatalogPath("tabular", "03_all_cities.xlsx");

    console.log("=== XLSX / snapshot pipeline ===");
    const rows = parseAllCitiesFiasXlsx(citiesPath);
    const importable = rows.filter(isFiasImportableRow);
    const drafts = mapFiasRowsToPlaceDrafts(rows);

    let unresolved = 0;
    const unresolvedByStem = new Map<string, number>();
    for (const draft of drafts) {
      if (resolveRegionFromIndex(index, draft.regionCode)) continue;
      unresolved += 1;
      unresolvedByStem.set(
        draft.regionCode,
        (unresolvedByStem.get(draft.regionCode) ?? 0) + 1,
      );
    }

    const oktmoDupInSnapshot = new Map<string, number>();
    for (const draft of drafts) {
      if (!draft.oktmo) continue;
      const key = `${draft.regionCode}:oktmo:${draft.oktmo}`;
      oktmoDupInSnapshot.set(key, (oktmoDupInSnapshot.get(key) ?? 0) + 1);
    }
    const snapshotOktmoDupExtra = [...oktmoDupInSnapshot.values()]
      .filter((count) => count > 1)
      .reduce((sum, count) => sum + count - 1, 0);

    const identityKeys = new Set<string>();
    for (const draft of drafts) {
      identityKeys.add(
        resolvePlaceIdentityKey({
          fiasId: draft.fiasId,
          oktmo: draft.oktmo,
          regionKey: draft.regionCode,
          kind: draft.kind,
          name: draft.name,
        }),
      );
    }

    const byNatural = new Map<string, number>();
    for (const draft of drafts) {
      const key = `${draft.regionCode}:${draft.kind}:${normalizeName(draft.name)}`;
      byNatural.set(key, (byNatural.get(key) ?? 0) + 1);
    }
    const naturalDupExtra = [...byNatural.values()]
      .filter((count) => count > 1)
      .reduce((sum, count) => sum + count - 1, 0);

    console.log(
      JSON.stringify(
        {
          rawRows: rows.length,
          importableRows: importable.length,
          skippedNotImportable: rows.length - importable.length,
          draftsAfterParserDedup: drafts.length,
          parserDedupRemoved: importable.length - drafts.length,
          unresolvedByRegionStem: unresolved,
          wouldBePlaceRows: drafts.length - unresolved,
          topUnresolvedStems: [...unresolvedByStem.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
          snapshotOktmoDuplicateKeys: [...oktmoDupInSnapshot.values()].filter((c) => c > 1).length,
          snapshotOktmoDupExtraRows: snapshotOktmoDupExtra,
          uniqueNaturalKeys: byNatural.size,
          naturalKeyDupExtraRows: naturalDupExtra,
          uniqueIdentityKeys: identityKeys.size,
          expectedDbIfIdentityUpsert: identityKeys.size,
          expectedDbIfNaturalKeyUpsert: drafts.length - naturalDupExtra,
        },
        null,
        2,
      ),
    );

    console.log("\n=== DB catalog places ===");
    const catalog = await dataSource.query(`
      SELECT
        COUNT(*)::int AS catalog_places,
        COUNT(*) FILTER (WHERE oktmo IS NOT NULL)::int AS with_oktmo,
        COUNT(*) FILTER (WHERE oktmo IS NULL)::int AS without_oktmo,
        COUNT(*) FILTER (WHERE name_stem IS NOT NULL AND name_stem <> '')::int AS with_stem,
        COUNT(*) FILTER (WHERE geo_feature_id IS NOT NULL)::int AS with_geo
      FROM places
      WHERE is_active = true AND kind <> 'region'
    `);
    console.log(JSON.stringify(catalog[0], null, 2));

    const oktmoDupDb = await dataSource.query(`
      SELECT COUNT(*)::int AS duplicate_groups,
             COALESCE(SUM(cnt - 1), 0)::int AS extra_rows
      FROM (
        SELECT COUNT(*)::int AS cnt
        FROM places
        WHERE is_active = true AND kind <> 'region' AND oktmo IS NOT NULL
        GROUP BY region_id, oktmo
        HAVING COUNT(*) > 1
      ) s
    `);
    console.log("oktmo duplicates in DB:", JSON.stringify(oktmoDupDb[0]));

    console.log("\n=== GEO orphan reasons (sample) ===");
    const orphanKinds = await dataSource.query(`
      SELECT kind, COUNT(*)::int AS cnt
      FROM places p
      WHERE p.is_active = true AND p.kind <> 'region'
        AND (p.name_stem IS NULL OR p.name_stem = '')
      GROUP BY kind
      ORDER BY cnt DESC
    `);
    console.log("places without name_stem by kind:", JSON.stringify(orphanKinds));

    const stemMatchSample = await dataSource.query(`
      SELECT gf.name AS geo_name, gf.name_stem AS geo_stem, gf.layer, r.iso,
        (
          SELECT COUNT(*)::int FROM places p
          WHERE p.region_id = gf.region_id AND p.is_active = true
            AND p.name_stem = gf.name_stem
        ) AS places_same_stem,
        (
          SELECT COUNT(*)::int FROM places p
          WHERE p.region_id = gf.region_id AND p.is_active = true
            AND p.kind = 'district'
        ) AS district_places_in_region
      FROM geo_feature gf
      JOIN regions r ON r.id = gf.region_id
      WHERE gf.is_active = true AND gf.layer = 'district'
        AND NOT EXISTS (
          SELECT 1 FROM places p WHERE p.geo_feature_id = gf.id AND p.is_active = true
        )
      LIMIT 10
    `);
    console.log(JSON.stringify(stemMatchSample, null, 2));

    const kindMismatch = await dataSource.query(`
      SELECT COUNT(*)::int AS cnt
      FROM geo_feature gf
      WHERE gf.is_active = true AND gf.layer = 'district'
        AND NOT EXISTS (
          SELECT 1 FROM places p
          WHERE p.region_id = gf.region_id AND p.is_active = true
            AND p.kind IN ('district', 'locality')
            AND p.name_stem = gf.name_stem
        )
    `);
    console.log("district geo without any place stem match:", kindMismatch[0]);

    const ntPlaces = await dataSource.query(`
      SELECT r.iso, COUNT(*)::int AS cnt
      FROM places p
      JOIN regions r ON r.id = p.region_id
      WHERE p.is_active = true AND p.kind <> 'region'
        AND r.iso IN ('RU-DON', 'RU-LUG', 'RU-ZP', 'RU-KHE')
      GROUP BY r.iso
      ORDER BY r.iso
    `);
    console.log("NT/frontline catalog places by region:", JSON.stringify(ntPlaces));
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
