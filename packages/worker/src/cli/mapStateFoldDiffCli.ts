/**
 * Shadow-сверка: fold фактов на now vs materialized read-model.
 *
 * Usage:
 *   npm run map:fold:diff -w @radar/worker
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import {
  foldMapState,
  type EventLocationFact,
  type MapStatusAction,
  type StateLevel,
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

async function loadFacts(
  dataSource: Awaited<ReturnType<typeof createWorkerDataSource>>,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  const cutoff = new Date(asOf.getTime() - ttlMs);
  const rows = (await dataSource.query(
    `
    SELECT el.id AS fact_id,
           el.region_id,
           r.iso AS region_code,
           el.place_id,
           COALESCE(el.status_code, pe.event_type) AS status_code,
           COALESCE(sd.state_level::text, 'grey') AS state_level,
           COALESCE(
             el.action,
             CASE WHEN pe.event_type = 'cleared' OR pe.is_active = false THEN 'clear' ELSE 'raise' END
           ) AS action,
           COALESCE(el.author_channel_key, c.key) AS author_channel_key,
           el.entity_kind,
           COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) AS occurred_at
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    JOIN raw_messages rm ON rm.id = pe.raw_message_id
    JOIN channels c ON c.id = rm.channel_id
    LEFT JOIN regions r ON r.id = el.region_id
    LEFT JOIN status_dictionary sd
      ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
    WHERE COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) <= $1::timestamptz
      AND COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) > $2::timestamptz
    `,
    [asOf.toISOString(), cutoff.toISOString()],
  )) as Array<{
    fact_id: string;
    region_id: string;
    region_code: string | null;
    place_id: string | null;
    status_code: string;
    state_level: string;
    action: string;
    author_channel_key: string | null;
    entity_kind: string | null;
    occurred_at: Date;
  }>;

  return rows.map((row) => ({
    factId: row.fact_id,
    regionId: row.region_id,
    regionCode: row.region_code ?? row.region_id,
    placeId: row.place_id,
    statusCode: row.status_code,
    stateLevel: row.state_level as StateLevel,
    action: row.action as MapStatusAction,
    occurredAt: new Date(row.occurred_at).toISOString(),
    authorChannelKey: row.author_channel_key,
    entityKind: row.entity_kind as EventLocationFact["entityKind"],
  }));
}

async function loadReadModel(
  dataSource: Awaited<ReturnType<typeof createWorkerDataSource>>,
): Promise<ReadModelRow[]> {
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
    WHERE stale = false OR action = 'raise'
    `,
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
    WHERE psm.action = 'raise' AND psm.stale = false
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

  const facts = await loadFacts(dataSource, asOf, ttlMs);
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

  const readRows = await loadReadModel(dataSource);
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
