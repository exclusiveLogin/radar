/**
 * Shadow-сверка: fold фактов на now vs materialized read-model (с теми же фильтрами, что API).
 *
 * Usage:
 *   npm run map:fold:diff -w @radar/worker
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  foldMapState,
  loadMapFoldFacts,
  REGION_CALM_SUPPRESS_MS,
  sqlPlaceNotSuppressedByRegionClear,
} from "@radar/shared";
import { resolveMapStateTtlMs } from "../infrastructure/config/mapStateExpiryConfig.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";

type ReadModelRow = {
  entity_key: string;
  entity_type: "region" | "place";
  region_code: string | null;
  state_level: string;
  action: string;
  winner_occurred_at: Date;
  stale: boolean;
};

async function loadReadModel(
  dataSource: Awaited<ReturnType<typeof createWorkerDataSource>>,
  asOf: Date,
): Promise<ReadModelRow[]> {
  const calmCutoff = new Date(asOf.getTime() - REGION_CALM_SUPPRESS_MS).toISOString();

  const regions = (await dataSource.query(
    `
    SELECT region_code AS entity_key,
           'region'::text AS entity_type,
           region_code,
           CASE WHEN stale THEN 'grey' ELSE state_level::text END AS state_level,
           action,
           winner_occurred_at,
           stale
    FROM region_status_read_model
    WHERE NOT (
      NOT stale
      AND state_level IN ('green', 'grey')
      AND winner_occurred_at < $1::timestamptz
    )
    `,
    [calmCutoff],
  )) as ReadModelRow[];

  const places = (await dataSource.query(
    `
    SELECT p.id::text AS entity_key,
           'place'::text AS entity_type,
           r.iso AS region_code,
           CASE WHEN psm.stale THEN 'grey' ELSE psm.state_level::text END AS state_level,
           psm.action,
           psm.winner_occurred_at,
           psm.stale
    FROM place_status_read_model psm
    JOIN places p ON p.id = psm.place_id
    LEFT JOIN regions r ON r.id = psm.region_id
    WHERE psm.action = 'raise'
      AND psm.stale = false
      ${sqlPlaceNotSuppressedByRegionClear("psm")}
    `,
  )) as ReadModelRow[];

  return [...regions, ...places];
}

function foldKey(type: "region" | "place", key: string): string {
  return `${type}:${key}`;
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const dataSource = await createWorkerDataSource();
  const asOf = new Date();
  const ttlMs = resolveMapStateTtlMs();

  const facts = await loadMapFoldFacts(dataSource, asOf, ttlMs);
  const folded = foldMapState({ asOf, ttlMs, facts });

  const foldRegions = new Map(
    folded.regions.map((r) => [
      foldKey("region", r.regionCode),
      { stateLevel: r.stateLevel, action: r.action, occurredAt: r.occurredAt },
    ]),
  );
  const foldPlaces = new Map(
    folded.places
      .filter((p) => p.placeId)
      .map((p) => [
        foldKey("place", p.placeId!),
        { stateLevel: p.stateLevel, action: p.action, occurredAt: p.occurredAt, regionCode: p.regionCode },
      ]),
  );

  const readRows = await loadReadModel(dataSource, asOf);
  const mismatches: Array<Record<string, unknown>> = [];

  for (const row of readRows) {
    if (row.stale) continue;
    const map = row.entity_type === "region" ? foldRegions : foldPlaces;
    const key = row.entity_type === "region"
      ? foldKey("region", row.region_code ?? row.entity_key)
      : foldKey("place", row.entity_key);
    const foldedRow = map.get(key);
    const readAt = new Date(row.winner_occurred_at).toISOString();
    if (!foldedRow) {
      mismatches.push({
        type: row.entity_type,
        key,
        issue: "missing_in_fold",
        read: { stateLevel: row.state_level, action: row.action, occurredAt: readAt },
      });
      continue;
    }
    if (
      foldedRow.stateLevel !== row.state_level
      || foldedRow.action !== row.action
      || foldedRow.occurredAt !== readAt
    ) {
      mismatches.push({
        type: row.entity_type,
        key,
        issue: "diff",
        read: { stateLevel: row.state_level, action: row.action, occurredAt: readAt },
        fold: foldedRow,
      });
    }
    map.delete(key);
  }

  for (const [key, foldRow] of foldRegions) {
    mismatches.push({ type: "region", key, issue: "extra_in_fold", fold: foldRow });
  }
  for (const [key, foldRow] of foldPlaces) {
    mismatches.push({ type: "place", key, issue: "extra_in_fold", fold: foldRow });
  }

  const report = {
    generatedAt: asOf.toISOString(),
    ttlMs,
    factsLoaded: facts.length,
    foldRegions: folded.regions.length,
    foldPlaces: folded.places.length,
    readModelRows: readRows.length,
    mismatchCount: mismatches.length,
    mismatches: mismatches.slice(0, 100),
  };

  const outDir = path.join(MONOREPO_ROOT, "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "map_fold_diff.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({
    mismatchCount: report.mismatchCount,
    foldRegions: report.foldRegions,
    foldPlaces: report.foldPlaces,
    report: jsonPath,
  }, null, 2));

  await dataSource.destroy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
