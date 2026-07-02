/**
 * Аудит ingest/parse/geo по каналу: последние N raw из БД vs offline catalog replay.
 *
 * Usage:
 *   npm run parse-engine:channel:audit -w @radar/worker -- --channel=radar-pf --limit=210 --catalog-only
 *   npm run parse-engine:channel:audit -w @radar/worker -- --channel=radar-pf --limit=70 --offset=70 --catalog-only
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MONOREPO_ROOT } from "@repo/root";
import type { ClassifiedPost } from "@radar/shared";
import { createParsePipeline } from "../application/parse/createParsePipeline.js";
import { loadIngestParsePhases } from "../application/parse/loadIngestParsePhases.js";
import { InMemoryRegionRepository } from "../application/handlers/inMemoryRepositories.js";
import { classifyContentKind } from "../domain/parsing/classifyContentKind.js";
import { RuleBasedEventClassifier } from "../infrastructure/classifiers/ruleBasedEventClassifier.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { GeoCatalog } from "../infrastructure/geo-catalog/index.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { createPlaceScanService } from "../infrastructure/place-scan/createPlaceScanService.js";
import {
  canonicalRegionCode,
  type NormalizedLocation,
} from "./geoLocationNormalize.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Коды gap между фактом в БД и replay каталога. */
export type GapCode =
  | "not_parsed"
  | "kind_mismatch"
  | "event_type_mismatch"
  | "no_locations_db"
  | "no_locations_replay"
  | "catalog_miss"
  | "location_count_mismatch"
  | "geocode_pending"
  | "geocode_failed"
  | "ok";

type DbLocation = {
  regionIso: string | null;
  placeName: string | null;
  placeId: string | null;
  entityKind: string | null;
  evidenceProviders: string[] | null;
  trustState: string | null;
  geoJobStatus: string | null;
};

type RawRow = {
  id: string;
  posted_at: string | Date;
  raw_text: string;
  ingest_mode: string;
  parsed_event_id: string | null;
  event_type: string | null;
  is_active: boolean | null;
};

/** Строка event_locations из SQL (snake_case). */
type DbLocationRow = {
  raw_message_id: string;
  region_iso: string | null;
  place_name: string | null;
  place_id: string | null;
  entity_kind: string | null;
  evidence_providers: string[] | null;
  trust_state: string | null;
  geo_job_status: string | null;
};

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

type AuditRow = {
  rawId: string;
  postedAt: string;
  ingestMode: string;
  preview: string;
  replayKind: "event" | "noise" | "meta";
  replayEventType: string | null;
  dbHasEvent: boolean;
  dbEventType: string | null;
  replayLocations: NormalizedLocation[];
  dbLocations: DbLocation[];
  gaps: GapCode[];
};

function normalizePlaceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+и\s+(?:близлежащ(?:ие|ие)|ближайш(?:ие|ее)|прилегающ(?:ие|их)\s+населённых\s+пунктов)(?:\s+\p{L}+)?$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function locSignature(regionCode: string, placeName: string | null): string {
  return `${regionCode}|${placeName ?? ""}`;
}

function normalizeDbLoc(row: DbLocation, catalog: GeoCatalog): NormalizedLocation | null {
  const code = canonicalRegionCode(catalog, row.regionIso);
  if (!code) return null;
  const placeName = normalizePlaceLabel(row.placeName);
  return {
    regionCode: code,
    placeName,
    precision: row.entityKind === "region" ? "region" : "locality",
    source: "db",
  };
}

function textPreview(text: string, lines = 2): string {
  return text
    .split("\n")
    .slice(0, lines)
    .join(" | ")
    .slice(0, 160);
}

function classifyGaps(input: {
  classified: ClassifiedPost;
  replayLocs: NormalizedLocation[];
  db: RawRow;
  dbLocations: DbLocation[];
  catalog: GeoCatalog;
}): GapCode[] {
  const gaps: GapCode[] = [];
  const replayKind = input.classified.kind;
  const dbHasEvent = Boolean(input.db.parsed_event_id);

  if (!dbHasEvent && replayKind === "event") {
    gaps.push("not_parsed");
  }

  if (dbHasEvent && replayKind !== "event") {
    gaps.push("kind_mismatch");
  }

  if (
    dbHasEvent
    && replayKind === "event"
    && input.classified.kind === "event"
    && input.db.event_type
    && input.classified.event.eventType !== input.db.event_type
  ) {
    gaps.push("event_type_mismatch");
  }

  if (dbHasEvent && input.dbLocations.length === 0 && replayKind === "event") {
    gaps.push("no_locations_db");
  }

  if (replayKind === "event" && input.replayLocs.length === 0 && dbHasEvent) {
    gaps.push("no_locations_replay");
  }

  const replaySet = new Set(
    input.replayLocs.map((loc) => locSignature(loc.regionCode, loc.placeName)),
  );
  const dbNorm = input.dbLocations
    .map((row) => normalizeDbLoc(row, input.catalog))
    .filter((loc): loc is NormalizedLocation => loc !== null);
  const dbSet = new Set(dbNorm.map((loc) => locSignature(loc.regionCode, loc.placeName)));

  if (replayKind === "event" && dbHasEvent && input.dbLocations.length > 0) {
    const replayOnly = [...replaySet].filter((sig) => !dbSet.has(sig));
    if (replayOnly.length > 0) gaps.push("catalog_miss");
    if (replaySet.size !== dbSet.size && !gaps.includes("catalog_miss")) {
      gaps.push("location_count_mismatch");
    }
  }

  for (const loc of input.dbLocations) {
    if (!loc.placeId) continue;
    const providers = loc.evidenceProviders ?? [];
    if (providers.length === 0 && loc.geoJobStatus === "pending") {
      gaps.push("geocode_pending");
    }
    if (loc.geoJobStatus === "failed" || loc.trustState === "rejected") {
      gaps.push("geocode_failed");
    }
  }

  if (gaps.length === 0) gaps.push("ok");
  return [...new Set(gaps)];
}

function buildMarkdownReport(input: {
  channelKey: string;
  limit: number;
  rows: AuditRow[];
  generatedAt: string;
}): string {
  const gapCounts = new Map<GapCode, number>();
  for (const row of input.rows) {
    for (const gap of row.gaps) {
      gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
    }
  }

  const problemRows = input.rows.filter((row) => !row.gaps.includes("ok") || row.gaps.length > 1);
  const parsed = input.rows.filter((row) => row.dbHasEvent).length;

  const lines: string[] = [
    `# Аудит канала ${input.channelKey} (${input.limit} сообщений)`,
    "",
    `Дата: \`${input.generatedAt}\``,
    "",
    "## Сводка",
    "",
    `- Сообщений: **${input.rows.length}**`,
    `- С parsed_event в БД: **${parsed}**`,
    `- С gap (не только ok): **${problemRows.length}**`,
    "",
    "### Gap-коды",
    "",
    "| Код | Кол-во |",
    "|-----|--------|",
  ];

  for (const [code, count] of [...gapCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${code}\` | ${count} |`);
  }

  lines.push("", "## Проблемные сообщения", "");
  if (problemRows.length === 0) {
    lines.push("_Нет проблемных записей._");
  } else {
    lines.push("| posted_at | gaps | replay | db | preview |");
    lines.push("|-----------|------|--------|-----|---------|");
    for (const row of problemRows.slice(0, 40)) {
      const gaps = row.gaps.filter((g) => g !== "ok").join(", ") || row.gaps.join(", ");
      const replay = row.replayKind === "event"
        ? `${row.replayEventType} (${row.replayLocations.length} loc)`
        : row.replayKind;
      const db = row.dbHasEvent
        ? `${row.dbEventType} (${row.dbLocations.length} loc)`
        : "—";
      lines.push(
        `| ${row.postedAt.slice(0, 19)} | ${gaps} | ${replay} | ${db} | ${row.preview.replace(/\|/g, "/")} |`,
      );
    }
    if (problemRows.length > 40) {
      lines.push("", `_…ещё ${problemRows.length - 40} строк в JSON._`);
    }
  }

  lines.push(
    "",
    "## Вывод",
    "",
    "- **Классификатор**: `kind_mismatch` / `event_type_mismatch` — семантика канала vs rule engine.",
    "- **Каталог**: `catalog_miss` / `no_locations_replay` — топоним не резолвится offline.",
    "- **Геокодер**: `geocode_pending` / `geocode_failed` — place без evidence (нужен geo:drain).",
    "- **Ingest**: `not_parsed` — raw без parsed_event при replay=event.",
    "",
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const allChannels = flags.has("all-channels");
  const randomOrder = flags.has("random");
  const sinceRaw = readStringFlag(flags, ["since"]);
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (sinceRaw && since && !Number.isFinite(since.getTime())) {
    throw new Error("--since должен быть валидным ISO datetime");
  }

  const catalogOnly = flags.has("catalog-only");
  const offsetRaw = readStringFlag(flags, ["offset"]);
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  if (offsetRaw && (!Number.isFinite(offset) || offset < 0)) {
    throw new Error("--offset должен быть неотрицательным числом");
  }

  if (allChannels) {
    const dataSource = await createWorkerDataSource();
    const channels = (await dataSource.query(
      `SELECT key FROM channels WHERE enabled = true ORDER BY key`,
    )) as Array<{ key: string }>;
    await dataSource.destroy();
    if (channels.length === 0) {
      console.error("Нет enabled channels");
      process.exit(1);
    }
    const limitRaw = readStringFlag(flags, ["limit"]);
    const totalLimit = limitRaw ? Number(limitRaw) : 150;
    const perChannel = Math.max(1, Math.floor(totalLimit / channels.length));
    for (const { key } of channels) {
      await runChannelAudit({
        channelKey: key,
        limit: perChannel,
        offset: 0,
        randomOrder,
        since,
        catalogOnly,
        outOverride: readStringFlag(flags, ["out"]),
      });
    }
    return;
  }

  const channelKey = readStringFlag(flags, ["channel"]) ?? "radar-rvk";
  const limitRaw = readStringFlag(flags, ["limit"]);
  const limit = limitRaw ? Number(limitRaw) : 100;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--limit должен быть положительным числом");
  }

  await runChannelAudit({
    channelKey,
    limit,
    offset,
    randomOrder,
    since,
    catalogOnly,
    outOverride: readStringFlag(flags, ["out"]),
  });
}

type AuditRunOptions = {
  channelKey: string;
  limit: number;
  offset: number;
  randomOrder: boolean;
  since: Date | null;
  catalogOnly: boolean;
  outOverride?: string;
};

async function runChannelAudit(options: AuditRunOptions): Promise<void> {
  const { channelKey, limit, offset, randomOrder, since, outOverride, catalogOnly } = options;
  const suffix = randomOrder ? "random" : "recent";
  const outMd =
    outOverride
    ?? path.join(
      MONOREPO_ROOT,
      "reports",
      `${channelKey.replace(/[^a-z0-9-]/gi, "_")}_audit_${suffix}_${limit}.md`,
    );
  const outJson = outMd.replace(/\.md$/i, ".json");

  const dataSource = await createWorkerDataSource();
  const repos = await createWorkerDbRepositories(dataSource);
  const placeScan = await createPlaceScanService({
    places: repos.places,
    regions: repos.regions,
  });
  const catalog = GeoCatalog.loadFromArtifacts();
  const classifier = new RuleBasedEventClassifier(
    catalog.getRegionCatalog(),
  );
  const pipeline = catalogOnly
    ? null
    : createParsePipeline({
      placeScan,
      regions: repos.regions,
      places: repos.places,
      ingestParsePhases: await loadIngestParsePhases({ repoRoot: MONOREPO_ROOT }),
    }).pipeline;

  const orderClause = randomOrder ? "ORDER BY random()" : "ORDER BY rm.posted_at DESC NULLS LAST";
  const sinceClause = since ? "AND rm.posted_at >= $3::timestamptz" : "";
  const offsetClause = offset > 0 ? `OFFSET ${offset}` : "";
  const params: unknown[] = since
    ? [channelKey, limit, since.toISOString()]
    : [channelKey, limit];

  const rawRows = (await dataSource.query(
    `
    SELECT rm.id,
           rm.posted_at,
           rm.raw_text,
           rm.ingest_mode,
           pe.id AS parsed_event_id,
           pe.event_type,
           pe.is_active
    FROM raw_messages rm
    JOIN channels ch ON ch.id = rm.channel_id AND ch.key = $1
    LEFT JOIN LATERAL (
      SELECT id, event_type, is_active
      FROM parsed_events
      WHERE raw_message_id = rm.id
      ORDER BY parsed_at DESC NULLS LAST
      LIMIT 1
    ) pe ON true
    WHERE true ${sinceClause}
    ${orderClause}
    ${offsetClause}
    LIMIT $2
    `,
    params,
  )) as RawRow[];

  if (rawRows.length === 0) {
    console.warn(`Канал '${channelKey}': raw_messages не найдены — skip`);
    await dataSource.destroy();
    return;
  }

  const rawIds = rawRows.map((row) => row.id);
  const locationRows = (await dataSource.query(
    `
    SELECT pe.raw_message_id,
           r.iso AS region_iso,
           p.name AS place_name,
           el.place_id,
           el.entity_kind,
           p.evidence_providers,
           p.trust_state,
           (
             SELECT j.status
             FROM place_enrichment_jobs j
             WHERE j.place_id = el.place_id
             ORDER BY j.updated_at DESC NULLS LAST
             LIMIT 1
           ) AS geo_job_status
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    LEFT JOIN regions r ON r.id = el.region_id
    LEFT JOIN places p ON p.id = el.place_id
    WHERE pe.raw_message_id = ANY($1::uuid[])
    `,
    [rawIds],
  )) as DbLocationRow[];

  const locByRaw = new Map<string, DbLocation[]>();
  for (const row of locationRows) {
    const list = locByRaw.get(row.raw_message_id) ?? [];
    list.push({
      regionIso: row.region_iso,
      placeName: row.place_name,
      placeId: row.place_id,
      entityKind: row.entity_kind,
      evidenceProviders: row.evidence_providers,
      trustState: row.trust_state,
      geoJobStatus: row.geo_job_status,
    });
    locByRaw.set(row.raw_message_id, list);
  }

  const auditRows: AuditRow[] = [];

  for (const raw of rawRows) {
    const classified = classifier.classify(raw.raw_text);
    const contentKind = classifyContentKind(raw.raw_text);
    const replayKind =
      classified.kind === "event"
        ? "event"
        : contentKind === "meta"
          ? "meta"
          : "noise";

    let replayLocs: NormalizedLocation[] = [];
    let replayEventType: string | null = null;

    if (classified.kind === "event") {
      replayEventType = classified.event.eventType;
      if (!catalogOnly && pipeline) {
        const postedAt = toIsoTimestamp(raw.posted_at);
        const result = await pipeline.execute({
          rawText: raw.raw_text,
          rawMessageId: raw.id,
          postedAt,
          channelKey,
        });
        replayLocs = result.locations.map((loc) => ({
          regionCode: canonicalRegionCode(catalog, loc.regionCode) ?? loc.regionCode,
          placeName: normalizePlaceLabel(loc.placeName),
          precision: loc.precision,
          source: loc.source,
        }));
      }
    }

    const dbLocations = locByRaw.get(raw.id) ?? [];
    const classifiedForGaps: ClassifiedPost =
      classified.kind === "event"
        ? classified
        : replayKind === "meta"
          ? { kind: "meta", reason: "meta_content" }
          : { kind: "noise", reason: classified.kind === "noise" ? classified.reason : "meta_content" };
    const gaps = classifyGaps({
      classified: classifiedForGaps,
      replayLocs,
      db: raw,
      dbLocations,
      catalog,
    });

    auditRows.push({
      rawId: raw.id,
      postedAt: toIsoTimestamp(raw.posted_at),
      ingestMode: raw.ingest_mode,
      preview: textPreview(raw.raw_text),
      replayKind,
      replayEventType,
      dbHasEvent: Boolean(raw.parsed_event_id),
      dbEventType: raw.event_type,
      replayLocations: replayLocs,
      dbLocations,
      gaps,
    });
  }

  const generatedAt = new Date().toISOString();
  const markdown = buildMarkdownReport({ channelKey, limit, rows: auditRows, generatedAt });

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, markdown, "utf8");
  fs.writeFileSync(
    outJson,
    JSON.stringify({ channelKey, limit, generatedAt, rows: auditRows }, null, 2),
    "utf8",
  );

  const gapSummary = new Map<string, number>();
  for (const row of auditRows) {
    for (const gap of row.gaps) {
      gapSummary.set(gap, (gapSummary.get(gap) ?? 0) + 1);
    }
  }

  console.log(`Channel audit: ${channelKey}, rows=${auditRows.length}`);
  console.log("Gaps:", Object.fromEntries(gapSummary));
  console.log(`Report: ${outMd}`);
  console.log(`JSON:  ${outJson}`);

  await dataSource.destroy();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`channel-ingest-audit failed: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
