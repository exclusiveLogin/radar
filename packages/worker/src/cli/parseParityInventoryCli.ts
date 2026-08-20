/**
 * SQL inventory: raw → workspace → parsed → mat_parse_location после backfill/rebuild.
 *
 * Usage:
 *   npm run parse-engine:parity:inventory -w @radar/worker
 *   npm run parse-engine:parity:inventory -w @radar/worker -- --out=reports/parse_parity_inventory.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

type CountRow = { count: string };

async function countQuery(
  dataSource: Awaited<ReturnType<typeof createWorkerDataSource>>,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const rows = (await dataSource.query(sql, params)) as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const outPath =
    readStringFlag(flags, ["out"])
    ?? path.join(MONOREPO_ROOT, "reports", "parse_parity_inventory.json");
  const sampleSize = Number(readStringFlag(flags, ["sample"]) ?? "100");
  if (!Number.isFinite(sampleSize) || sampleSize < 1) {
    throw new Error("--sample должен быть положительным числом");
  }

  const dataSource = await createWorkerDataSource();
  const generatedAt = new Date().toISOString();

  const [
    rawTotal,
    rawWithoutParsed,
    rawWithoutWorkspace,
    parsedWithoutLocations,
    orphanLocations,
    workspaceDrift,
    occurredAtMismatch,
    occurredAtTotal,
    placeRaiseWithoutPlaceId,
    placeRaiseTotal,
  ] = await Promise.all([
    countQuery(dataSource, `SELECT COUNT(*)::text AS count FROM mat_ingest_raw`),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_ingest_raw rm
       WHERE NOT EXISTS (SELECT 1 FROM mat_parse_event pe WHERE pe.raw_message_id = rm.id)`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_ingest_raw rm
       WHERE NOT EXISTS (
         SELECT 1 FROM work_parse_message mpw
         WHERE mpw.raw_message_id = rm.id
       )`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_event pe
       WHERE pe.is_active = true
         AND pe.event_type NOT IN ('cleared', 'unknown')
         AND NOT EXISTS (SELECT 1 FROM mat_parse_location el WHERE el.parsed_event_id = pe.id)`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       WHERE el.parsed_event_id IS NULL`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM work_parse_message mpw
       CROSS JOIN LATERAL unnest(mpw.spawned_event_ids) AS sid(id)
       WHERE NOT EXISTS (SELECT 1 FROM mat_parse_event pe WHERE pe.id = sid.id)`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
       JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       WHERE el.occurred_at IS DISTINCT FROM rm.posted_at`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       JOIN mat_parse_event pe ON pe.id = el.parsed_event_id`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       WHERE el.action = 'raise'
         AND el.entity_kind = 'place'
         AND el.place_id IS NULL`,
    ),
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       WHERE el.action = 'raise'
         AND el.entity_kind = 'place'`,
    ),
  ]);

  const randomSample = (await dataSource.query(
    `SELECT rm.id, rm.posted_at, left(rm.raw_text, 120) AS preview
     FROM mat_ingest_raw rm
     ORDER BY random()
     LIMIT $1`,
    [sampleSize],
  )) as Array<{ id: string; posted_at: Date; preview: string }>;

  const sampleIds = randomSample.map((row) => row.id);
  const workspaceLineage = sampleIds.length > 0
    ? ((await dataSource.query(
        `SELECT mpw.raw_message_id,
                mpw.status,
                COALESCE(array_length(mpw.spawned_event_ids, 1), 0) AS spawned_count,
                (SELECT COUNT(*)::int FROM mat_parse_event pe WHERE pe.raw_message_id = mpw.raw_message_id) AS pe_count,
                (SELECT COUNT(*)::int
                 FROM mat_parse_location el
                 JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
                 WHERE pe.raw_message_id = mpw.raw_message_id) AS el_count
         FROM work_parse_message mpw
         WHERE mpw.raw_message_id = ANY($1::uuid[])`,
        [sampleIds],
      )) as Array<{
        raw_message_id: string;
        status: string;
        spawned_count: number;
        pe_count: number;
        el_count: number;
      }>)
    : [];

  const lineageIssues = workspaceLineage.filter(
    (row) => row.status !== "finalized" || row.pe_count < 1,
  );

  const [heatmapEligible] = await Promise.all([
    countQuery(
      dataSource,
      `SELECT COUNT(*)::text AS count
       FROM mat_parse_location el
       JOIN mat_parse_event pe ON pe.id = el.parsed_event_id AND pe.is_active = true
       JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       LEFT JOIN places p ON p.id = el.place_id AND p.is_active = true
       LEFT JOIN LATERAL (
         SELECT l.geo_feature_id FROM place_geo_link l
         WHERE l.place_id = p.id ORDER BY l.priority ASC LIMIT 1
       ) pgl ON el.place_id IS NOT NULL
       LEFT JOIN geo_feature gf ON gf.id = COALESCE(p.geo_feature_id, pgl.geo_feature_id)
       LEFT JOIN regions r ON r.id = el.region_id
       JOIN status_dictionary sd ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
       WHERE el.action = 'raise'
         AND sd.state_level NOT IN ('grey', 'green')
         AND COALESCE(el.lon, p.centroid_lon, gf.centroid_lon, r.centroid_lon) IS NOT NULL
         AND (el.place_id IS NOT NULL OR el.region_id IS NOT NULL)`,
    ),
  ]);

  const report = {
    generatedAt,
    counts: {
      rawTotal,
      rawWithoutParsed,
      rawWithoutWorkspace,
      parsedWithoutLocations,
      orphanLocations,
      workspaceDrift,
      occurredAtMismatch,
      occurredAtTotal,
      occurredAtMismatchPct:
        occurredAtTotal > 0
          ? Math.round((occurredAtMismatch / occurredAtTotal) * 1000) / 10
          : 0,
      placeRaiseWithoutPlaceId,
      placeRaiseTotal,
      placeRaiseWithoutPlaceIdPct:
        placeRaiseTotal > 0
          ? Math.round((placeRaiseWithoutPlaceId / placeRaiseTotal) * 1000) / 10
          : 0,
      heatmapEligible,
      heatmapEligiblePctRaw:
        rawTotal > 0 ? Math.round((heatmapEligible / rawTotal) * 10000) / 100 : 0,
    },
    randomSample: randomSample.map((row) => ({
      id: row.id,
      postedAt: row.posted_at instanceof Date ? row.posted_at.toISOString() : row.posted_at,
      preview: row.preview,
    })),
    workspaceLineage: {
      checked: workspaceLineage.length,
      issues: lineageIssues.length,
      rows: workspaceLineage,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Parse parity inventory:");
  console.log(JSON.stringify(report.counts, null, 2));
  console.log(`Workspace lineage issues (sample): ${lineageIssues.length}/${workspaceLineage.length}`);
  console.log(`Report: ${outPath}`);

  await dataSource.destroy();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`parse-parity-inventory failed: ${message}`);
  process.exit(1);
});
