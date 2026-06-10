/**
 * Диагностика консистентности после geo:catalog:import.
 * Запуск: npx tsx src/scripts/geo-catalog/consistency-check.ts
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import dataSource from "../../data-source";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

type Row = Record<string, unknown>;

async function q<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return dataSource.query(sql, params) as Promise<T[]>;
}

async function run(): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const summary = await q<{ label: string; cnt: string }>(`
      SELECT 'regions_active' AS label, COUNT(*)::text AS cnt FROM regions WHERE is_active = true
      UNION ALL SELECT 'places_active', COUNT(*)::text FROM places WHERE is_active = true
      UNION ALL SELECT 'places_region_kind', COUNT(*)::text FROM places WHERE is_active = true AND kind = 'region'
      UNION ALL SELECT 'place_aliases', COUNT(*)::text FROM place_aliases
      UNION ALL SELECT 'geo_features_active', COUNT(*)::text FROM geo_feature WHERE is_active = true
      UNION ALL SELECT 'place_geo_link', COUNT(*)::text FROM place_geo_link
      UNION ALL SELECT 'places_with_geo_feature_id', COUNT(*)::text FROM places WHERE is_active = true AND geo_feature_id IS NOT NULL
      UNION ALL SELECT 'region_adjacency', COUNT(*)::text FROM region_adjacency
    `);

    const placesByKind = await q<{ kind: string; cnt: string }>(`
      SELECT kind, COUNT(*)::text AS cnt
      FROM places WHERE is_active = true
      GROUP BY kind ORDER BY kind
    `);

    const geoByLayer = await q<{ layer: string; cnt: string }>(`
      SELECT layer, COUNT(*)::text AS cnt
      FROM geo_feature WHERE is_active = true
      GROUP BY layer ORDER BY layer
    `);

    const issues: Array<{ check: string; cnt: string; sample?: unknown }> = [];

    const regionWithoutMirror = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM regions r
      WHERE r.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM places p
          WHERE p.region_id = r.id AND p.kind = 'region' AND p.is_active = true
        )
    `);
    if (Number(regionWithoutMirror[0]?.cnt) > 0) {
      issues.push({
        check: "regions без place(kind=region)",
        cnt: regionWithoutMirror[0].cnt,
        sample: await q(`
          SELECT r.id, r.iso, r.name FROM regions r
          WHERE r.is_active = true
            AND NOT EXISTS (
              SELECT 1 FROM places p
              WHERE p.region_id = r.id AND p.kind = 'region' AND p.is_active = true
            )
          LIMIT 10
        `),
      });
    }

    const orphanRegionPlaces = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM places p
      WHERE p.is_active = true AND p.kind = 'region'
        AND NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = p.region_id AND r.is_active = true)
    `);
    if (Number(orphanRegionPlaces[0]?.cnt) > 0) {
      issues.push({ check: "place(kind=region) без regions", cnt: orphanRegionPlaces[0].cnt });
    }

    const placesBadRegionFk = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM places p
      WHERE p.is_active = true AND p.kind <> 'region'
        AND NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = p.region_id AND r.is_active = true)
    `);
    if (Number(placesBadRegionFk[0]?.cnt) > 0) {
      issues.push({
        check: "places (не region) с битым region_id",
        cnt: placesBadRegionFk[0].cnt,
        sample: await q(`
          SELECT p.id, p.kind, p.name, p.region_id FROM places p
          WHERE p.is_active = true AND p.kind <> 'region'
            AND NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = p.region_id AND r.is_active = true)
          LIMIT 5
        `),
      });
    }

    const aliasOrphans = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM place_aliases a
      WHERE NOT EXISTS (SELECT 1 FROM places p WHERE p.id = a.place_id AND p.is_active = true)
    `);
    if (Number(aliasOrphans[0]?.cnt) > 0) {
      issues.push({ check: "aliases без active place", cnt: aliasOrphans[0].cnt });
    }

    const geoBadRegion = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM geo_feature gf
      WHERE gf.is_active = true AND gf.region_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = gf.region_id AND r.is_active = true)
    `);
    if (Number(geoBadRegion[0]?.cnt) > 0) {
      issues.push({ check: "geo_feature с битым region_id", cnt: geoBadRegion[0].cnt });
    }

    const geoOrphanNoPlace = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM geo_feature gf
      WHERE gf.is_active = true
        AND NOT EXISTS (SELECT 1 FROM places p WHERE p.geo_feature_id = gf.id AND p.is_active = true)
        AND NOT EXISTS (SELECT 1 FROM place_geo_link l WHERE l.geo_feature_id = gf.id)
    `);
    if (Number(geoOrphanNoPlace[0]?.cnt) > 0) {
      const byLayer = await q(`
        SELECT gf.layer, COUNT(*)::text AS cnt
        FROM geo_feature gf
        WHERE gf.is_active = true
          AND NOT EXISTS (SELECT 1 FROM places p WHERE p.geo_feature_id = gf.id AND p.is_active = true)
          AND NOT EXISTS (SELECT 1 FROM place_geo_link l WHERE l.geo_feature_id = gf.id)
        GROUP BY gf.layer ORDER BY gf.layer
      `);
      issues.push({
        check: "geo_feature без link на place",
        cnt: geoOrphanNoPlace[0].cnt,
        sample: byLayer,
      });
    }

    const placeGeoFkBroken = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM places p
      WHERE p.is_active = true AND p.geo_feature_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM geo_feature gf WHERE gf.id = p.geo_feature_id AND gf.is_active = true)
    `);
    if (Number(placeGeoFkBroken[0]?.cnt) > 0) {
      issues.push({ check: "places.geo_feature_id → несуществующий geo_feature", cnt: placeGeoFkBroken[0].cnt });
    }

    const linkBroken = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM place_geo_link l
      WHERE NOT EXISTS (SELECT 1 FROM places p WHERE p.id = l.place_id AND p.is_active = true)
         OR NOT EXISTS (SELECT 1 FROM geo_feature gf WHERE gf.id = l.geo_feature_id AND gf.is_active = true)
    `);
    if (Number(linkBroken[0]?.cnt) > 0) {
      issues.push({ check: "place_geo_link с битым place или geo_feature", cnt: linkBroken[0].cnt });
    }

    const subjectUnlinked = await q<{ cnt: string }>(`
      SELECT COUNT(*)::text AS cnt
      FROM geo_feature gf
      WHERE gf.is_active = true AND gf.layer = 'subject'
        AND NOT EXISTS (SELECT 1 FROM place_geo_link l WHERE l.geo_feature_id = gf.id)
    `);
    if (Number(subjectUnlinked[0]?.cnt) > 0) {
      issues.push({ check: "geo_feature(subject) без place_geo_link", cnt: subjectUnlinked[0].cnt });
    }

    const linkedStats = await q(`
      SELECT
        gf.layer,
        COUNT(*)::text AS features,
        COUNT(DISTINCT p.id)::text AS places_via_geo_feature_id,
        COUNT(DISTINCT l.place_id)::text AS places_via_link
      FROM geo_feature gf
      LEFT JOIN places p ON p.geo_feature_id = gf.id AND p.is_active = true
      LEFT JOIN place_geo_link l ON l.geo_feature_id = gf.id
      WHERE gf.is_active = true
      GROUP BY gf.layer
      ORDER BY gf.layer
    `);

    console.log("=== SUMMARY ===");
    for (const row of summary) {
      console.log(`${row.label}: ${row.cnt}`);
    }

    console.log("\n=== places BY kind ===");
    for (const row of placesByKind) {
      console.log(`${row.kind}: ${row.cnt}`);
    }

    console.log("\n=== geo_feature BY layer ===");
    for (const row of geoByLayer) {
      console.log(`${row.layer}: ${row.cnt}`);
    }

    console.log("\n=== geometry LINK stats ===");
    console.log(JSON.stringify(linkedStats, null, 2));

    const regionCoverage = await q(`
      SELECT r.iso, r.name,
        EXISTS (
          SELECT 1 FROM places p
          WHERE p.region_id = r.id AND p.kind = 'region' AND p.is_active = true
        ) AS has_mirror,
        (
          SELECT COUNT(*)::int FROM place_aliases a
          JOIN places p ON p.id = a.place_id
          WHERE p.region_id = r.id AND p.kind = 'region' AND p.is_active = true
        ) AS region_alias_cnt,
        EXISTS (
          SELECT 1 FROM geo_feature gf
          WHERE gf.region_id = r.id AND gf.layer = 'subject' AND gf.is_active = true
        ) AS has_subject_geo,
        EXISTS (
          SELECT 1 FROM place_geo_link l
          JOIN geo_feature gf ON gf.id = l.geo_feature_id
          JOIN places p ON p.id = l.place_id
          WHERE gf.region_id = r.id AND gf.layer = 'subject'
            AND p.kind = 'region' AND p.is_active = true
        ) AS subject_linked,
        (
          SELECT COUNT(*)::int FROM places p
          WHERE p.region_id = r.id AND p.is_active = true AND p.kind <> 'region'
        ) AS catalog_places_cnt
      FROM regions r
      WHERE r.is_active = true
      ORDER BY r.iso
    `);

    const regionGaps = regionCoverage.filter(
      (row) => !row.has_mirror || !row.has_subject_geo || !row.subject_linked,
    );

    const duplicateMirrors = await q(`
      SELECT p.region_id, r.iso, COUNT(*)::text AS cnt
      FROM places p
      JOIN regions r ON r.id = p.region_id
      WHERE p.is_active = true AND p.kind = 'region'
      GROUP BY p.region_id, r.iso
      HAVING COUNT(*) > 1
    `);

    const aliasStats = await q(`
      SELECT
        COUNT(*)::text AS total_aliases,
        COUNT(DISTINCT place_id)::text AS places_with_alias,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM places p WHERE p.id = place_aliases.place_id AND p.is_active = true
          )
        )::text AS orphan_aliases
      FROM place_aliases
    `);

    const linkMismatch = await q(`
      SELECT COUNT(*)::text AS cnt
      FROM place_geo_link l
      JOIN places p ON p.id = l.place_id AND p.is_active = true
      JOIN geo_feature gf ON gf.id = l.geo_feature_id AND gf.is_active = true
      WHERE p.kind = 'region' AND gf.layer = 'subject' AND p.region_id IS DISTINCT FROM gf.region_id
    `);

    console.log("\n=== REGION coverage ===");
    console.log(`total: ${regionCoverage.length}`);
    console.log(`gaps (mirror/subject geo/link): ${regionGaps.length}`);
    if (regionGaps.length > 0) {
      console.log(JSON.stringify(regionGaps, null, 2));
    }

    console.log("\n=== ALIASES ===");
    console.log(JSON.stringify(aliasStats[0], null, 2));

    if (duplicateMirrors.length > 0) {
      issues.push({ check: "дубли place(kind=region) на region_id", cnt: String(duplicateMirrors.length), sample: duplicateMirrors });
    }
    if (Number(linkMismatch[0]?.cnt) > 0) {
      issues.push({ check: "place_geo_link subject: region_id place ≠ geo_feature", cnt: linkMismatch[0].cnt });
    }

    console.log("\n=== ISSUES ===");
    if (issues.length === 0) {
      console.log("OK — структурных нарушений FK/зеркал не найдено");
    } else {
      for (const issue of issues) {
        console.log(`\n[${issue.check}] count=${issue.cnt}`);
        if (issue.sample) {
          console.log(JSON.stringify(issue.sample, null, 2));
        }
      }
    }
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
