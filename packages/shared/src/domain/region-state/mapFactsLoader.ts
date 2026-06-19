import { withPgContendedReadRetry } from "../../infrastructure/pgDeadlockRetry.js";
import type { StateLevel } from "../../schemas/geo/state-level";
import type { EventLocationFact } from "./mapStateFold";
import { shouldIncomingBeatWinner } from "./mapStateFold";
import type { MapStatusAction } from "./statusEventOrdering";
import {
  isMassClearTextEligible,
  resolveMassClearTargets,
  type MassClearRegionRef,
} from "./massClearTargets";

/** Минимальный контракт БД для загрузки фактов карты (TypeORM DataSource и worker DS). */
export type MapFactsDbQuery = {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
};

/** @deprecated используй MapFactsDbQuery */
export type MapFoldDbQuery = MapFactsDbQuery;

const MAP_FACTS_STATEMENT_TIMEOUT_MS = 8_000;

type QueryRunnerLike = {
  connect(): Promise<void>;
  release(): Promise<void>;
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
};

type DataSourceWithQueryRunner = MapFactsDbQuery & {
  createQueryRunner(): QueryRunnerLike;
};

function hasPinnedConnection(db: MapFactsDbQuery): db is DataSourceWithQueryRunner {
  return typeof (db as DataSourceWithQueryRunner).createQueryRunner === "function";
}

/**
 * Одно PG-соединение на весь fold-read (pool-safe).
 * statement_timeout через SET LOCAL внутри READ ONLY tx.
 */
async function runMapFactsReadSession<T>(
  db: MapFactsDbQuery,
  fn: (session: MapFactsDbQuery) => Promise<T>,
): Promise<T> {
  if (!hasPinnedConnection(db)) {
    return fn(db);
  }

  const runner = db.createQueryRunner();
  await runner.connect();
  const session: MapFactsDbQuery = {
    query: <T>(sql: string, parameters?: unknown[]) =>
      runner.query(sql, parameters) as Promise<T>,
  };

  try {
    await session.query("BEGIN READ ONLY");
    await session.query(`SET LOCAL statement_timeout = '${MAP_FACTS_STATEMENT_TIMEOUT_MS}'`);
    return await fn(session);
  } finally {
    await session.query("ROLLBACK").catch(() => undefined);
    await runner.release();
  }
}

type FactRow = {
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
};

type SyntheticClearRow = {
  fact_id: string;
  region_id: string;
  region_code: string | null;
  status_code: string;
  state_level: string;
  author_channel_key: string | null;
  occurred_at: Date;
};

type MassClearCandidateRow = {
  parsed_event_id: string;
  raw_text: string;
  channel_key: string | null;
  event_type: string;
  non_place_location_count: string;
  occurred_at: Date;
  status_code: string;
  state_level: string;
};

function toFact(row: FactRow): EventLocationFact {
  return {
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
  };
}

function toRegionClearFact(row: SyntheticClearRow, prefix: string): EventLocationFact {
  return {
    factId: `${prefix}:${row.fact_id}:${row.region_id}`,
    regionId: row.region_id,
    regionCode: row.region_code ?? row.region_id,
    placeId: null,
    statusCode: row.status_code,
    stateLevel: row.state_level as StateLevel,
    action: "clear",
    occurredAt: new Date(row.occurred_at).toISOString(),
    authorChannelKey: row.author_channel_key,
    entityKind: "region",
  };
}

/** Область загрузки location facts для split read-path. */
export type MapFactsLocationScope = "all" | "regions" | "places";

function scopeFilterSql(scope: MapFactsLocationScope): string {
  if (scope === "regions") {
    return `AND el.place_id IS NULL AND COALESCE(el.entity_kind, 'region') <> 'place'`;
  }
  if (scope === "places") {
    return `AND el.place_id IS NOT NULL AND COALESCE(el.entity_kind, 'region') <> 'region'`;
  }
  return "";
}

/**
 * Время события на read-line: el.occurred_at (SSOT после write-line backfill).
 */
async function loadLocationFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  cutoff: Date,
  scope: MapFactsLocationScope = "all",
): Promise<EventLocationFact[]> {
  const rows = await db.query<FactRow[]>(
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
           el.occurred_at AS occurred_at
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    JOIN raw_messages rm ON rm.id = pe.raw_message_id
    JOIN channels c ON c.id = rm.channel_id
    LEFT JOIN regions r ON r.id = el.region_id
    LEFT JOIN status_dictionary sd
      ON sd.code = COALESCE(el.status_code, pe.event_type) AND sd.is_active = true
    WHERE el.occurred_at <= $1::timestamptz
      AND el.occurred_at > $2::timestamptz
      ${scopeFilterSql(scope)}
    `,
    [asOf.toISOString(), cutoff.toISOString()],
  );

  return rows.map(toFact);
}

/**
 * Глобальный отбой без locations: синтетические clear по регионам канала с raise за 24ч до clear.
 */
async function loadChannelClearFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  cutoff: Date,
): Promise<EventLocationFact[]> {
  const rows = await db.query<SyntheticClearRow[]>(
    `
    WITH global_clears AS (
      SELECT pe.id AS parsed_event_id,
             rm.posted_at AS clear_at,
             c.key AS channel_key,
             COALESCE(pe.extras->'excludedRegionCodes', '[]'::jsonb) AS excluded_region_codes
      FROM parsed_events pe
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id
      WHERE (pe.event_type = 'cleared' OR pe.is_active = false)
        AND COALESCE(pe.extras->>'massClearChannel', 'false') = 'true'
        AND rm.posted_at <= $1::timestamptz
        AND rm.posted_at > $2::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM event_locations el WHERE el.parsed_event_id = pe.id
        )
    )
    SELECT DISTINCT ON (gc.parsed_event_id, el.region_id)
           gc.parsed_event_id::text AS fact_id,
           el.region_id,
           r.iso AS region_code,
           COALESCE(sd_clear.code, 'cleared') AS status_code,
           COALESCE(sd_clear.state_level::text, 'green') AS state_level,
           gc.channel_key AS author_channel_key,
           gc.clear_at AS occurred_at
    FROM global_clears gc
    JOIN event_locations el ON el.action = 'raise'
      AND el.occurred_at > gc.clear_at - INTERVAL '24 hours'
      AND el.occurred_at <= $1::timestamptz
    JOIN parsed_events pe_raise ON pe_raise.id = el.parsed_event_id
    JOIN raw_messages rm_raise ON rm_raise.id = pe_raise.raw_message_id
    JOIN channels c_raise ON c_raise.id = rm_raise.channel_id AND c_raise.key = gc.channel_key
    JOIN regions r ON r.id = el.region_id
    LEFT JOIN status_dictionary sd_clear
      ON sd_clear.code = 'cleared' AND sd_clear.is_active = true
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(gc.excluded_region_codes) excluded(code)
      WHERE excluded.code = r.iso
    )
    ORDER BY gc.parsed_event_id, el.region_id, el.occurred_at DESC
    `,
    [asOf.toISOString(), cutoff.toISOString()],
  );

  return rows.map((row) => toRegionClearFact(row, "synthetic-channel-clear"));
}

/** Групповой отбой из raw_text (resolveClearTargets). */
async function loadMassClearFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  cutoff: Date,
  regions: MassClearRegionRef[],
): Promise<EventLocationFact[]> {
  const rows = await db.query<MassClearCandidateRow[]>(
    `
    SELECT pe.id::text AS parsed_event_id,
           rm.raw_text,
           c.key AS channel_key,
           pe.event_type,
           (
             SELECT COUNT(*)::text
             FROM event_locations el
             WHERE el.parsed_event_id = pe.id
               AND COALESCE(el.entity_kind, 'region') <> 'place'
           ) AS non_place_location_count,
           rm.posted_at AS occurred_at,
           COALESCE(sd_clear.code, 'cleared') AS status_code,
           COALESCE(sd_clear.state_level::text, 'green') AS state_level
    FROM parsed_events pe
    JOIN raw_messages rm ON rm.id = pe.raw_message_id
    JOIN channels c ON c.id = rm.channel_id
    LEFT JOIN status_dictionary sd_clear
      ON sd_clear.code = 'cleared' AND sd_clear.is_active = true
    WHERE (pe.event_type = 'cleared' OR pe.is_active = false)
      AND rm.posted_at <= $1::timestamptz
      AND rm.posted_at > $2::timestamptz
      AND EXISTS (SELECT 1 FROM event_locations el WHERE el.parsed_event_id = pe.id)
    `,
    [asOf.toISOString(), cutoff.toISOString()],
  );

  const facts: EventLocationFact[] = [];
  for (const row of rows) {
    const nonPlaceCount = Number(row.non_place_location_count);
    if (!isMassClearTextEligible(row.event_type, nonPlaceCount)) continue;

    const targets = resolveMassClearTargets(row.raw_text, regions);
    for (const target of targets) {
      facts.push({
        factId: `synthetic-mass-clear:${row.parsed_event_id}:${target.regionId}`,
        regionId: target.regionId,
        regionCode: target.regionCode,
        placeId: null,
        statusCode: row.status_code,
        stateLevel: row.state_level as StateLevel,
        action: "clear",
        occurredAt: new Date(row.occurred_at).toISOString(),
        authorChannelKey: row.channel_key,
        entityKind: "region",
      });
    }
  }
  return facts;
}

async function loadActiveRegions(db: MapFoldDbQuery): Promise<MassClearRegionRef[]> {
  const rows = await db.query<
    Array<{
      id: string;
      iso: string | null;
      name: string;
      name_with_type: string | null;
      short_name: string | null;
    }>
  >(
    `
    SELECT id, iso, name, name_with_type, short_name
    FROM regions
    WHERE is_active = true
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    iso: row.iso,
    name: row.name,
    nameWithType: row.name_with_type,
    shortName: row.short_name,
  }));
}

/**
 * Синтетические place-clear при региональном отбое.
 * Покрывает clearAuthorPlacesInRegion и applyRegionalClearToPlaces (sweep):
 * любой place raise в регионе до clear гасится, даже без строки в event_locations.
 */
export function buildAuthorPlaceClearFacts(
  regionClearFacts: EventLocationFact[],
  placeRaiseFacts: EventLocationFact[],
): EventLocationFact[] {
  const synthetics: EventLocationFact[] = [];

  for (const clear of regionClearFacts) {
    if (clear.placeId) continue;

    const candidates = placeRaiseFacts.filter(
      (fact) =>
        fact.placeId
        && fact.regionId === clear.regionId
        && Date.parse(fact.occurredAt) <= Date.parse(clear.occurredAt),
    );

    const winnerByPlace = new Map<string, EventLocationFact>();
    const sorted = [...candidates].sort((a, b) => {
      const at = Date.parse(a.occurredAt);
      const bt = Date.parse(b.occurredAt);
      if (at !== bt) return at - bt;
      return a.factId.localeCompare(b.factId);
    });

    for (const fact of sorted) {
      if (!fact.placeId) continue;
      const current = winnerByPlace.get(fact.placeId);
      if (!shouldIncomingBeatWinner(
        current
          ? {
            regionId: current.regionId,
            regionCode: current.regionCode,
            placeId: current.placeId ?? undefined,
            statusCode: current.statusCode,
            stateLevel: current.stateLevel,
            action: current.action,
            occurredAt: current.occurredAt,
          }
          : undefined,
        fact,
      )) {
        continue;
      }
      winnerByPlace.set(fact.placeId, fact);
    }

    for (const [placeId, winner] of winnerByPlace) {
      if (winner.action !== "raise") continue;
      synthetics.push({
        factId: `synthetic-place-clear:${clear.factId}:${placeId}`,
        regionId: clear.regionId,
        regionCode: clear.regionCode,
        placeId,
        statusCode: clear.statusCode,
        stateLevel: clear.stateLevel,
        action: "clear",
        occurredAt: clear.occurredAt,
        authorChannelKey: winner.authorChannelKey,
        entityKind: "place",
      });
    }
  }

  return synthetics;
}

function collectRegionClearFacts(facts: EventLocationFact[]): EventLocationFact[] {
  return facts.filter(
    (fact) => !fact.placeId && fact.action === "clear" && fact.entityKind !== "place",
  );
}

/** Region winners: region-scoped locations + mass/channel clear synthetics. */
export async function loadRegionMapFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  return withPgContendedReadRetry(
    () => runMapFactsReadSession(db, (session) => loadRegionMapFactsOnce(session, asOf, ttlMs)),
    { maxAttempts: 3, baseDelayMs: 60 },
  );
}

async function loadRegionMapFactsOnce(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  const cutoff = new Date(asOf.getTime() - ttlMs);
  const locationFacts = await loadLocationFacts(db, asOf, cutoff, "regions");
  const regions = await loadActiveRegions(db);
  const massClearFacts = await loadMassClearFacts(db, asOf, cutoff, regions);
  const channelClearFacts = await loadChannelClearFacts(db, asOf, cutoff);
  return [...locationFacts, ...massClearFacts, ...channelClearFacts];
}

/** Place layer: place locations + synthetic place-clear от region clears. */
export async function loadPlaceMapFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
  regionClears?: EventLocationFact[],
): Promise<EventLocationFact[]> {
  return withPgContendedReadRetry(
    () => runMapFactsReadSession(db, (session) =>
      loadPlaceMapFactsOnce(session, asOf, ttlMs, regionClears),
    ),
    { maxAttempts: 3, baseDelayMs: 60 },
  );
}

async function loadPlaceMapFactsOnce(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
  regionClears?: EventLocationFact[],
): Promise<EventLocationFact[]> {
  const cutoff = new Date(asOf.getTime() - ttlMs);
  const locationFacts = await loadLocationFacts(db, asOf, cutoff, "places");
  const placeRaiseFacts = locationFacts.filter(
    (fact) => fact.placeId && fact.entityKind !== "region",
  );

  let clears = regionClears;
  if (!clears) {
    const regionFacts = await loadRegionMapFactsOnce(db, asOf, ttlMs);
    clears = collectRegionClearFacts(regionFacts);
  }

  const authorPlaceClearFacts = buildAuthorPlaceClearFacts(clears, placeRaiseFacts);
  return [...locationFacts, ...authorPlaceClearFacts];
}

/** Полная загрузка фактов для fold: locations + синтетики mass/channel/place-clear. */
export async function loadMapFacts(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  return withPgContendedReadRetry(
    () => runMapFactsReadSession(db, (session) => loadMapFactsOnce(session, asOf, ttlMs)),
    { maxAttempts: 3, baseDelayMs: 60 },
  );
}

async function loadMapFactsOnce(
  db: MapFactsDbQuery,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  const regionFacts = await loadRegionMapFactsOnce(db, asOf, ttlMs);
  const regionClears = collectRegionClearFacts(regionFacts);
  const placeFacts = await loadPlaceMapFactsOnce(db, asOf, ttlMs, regionClears);
  return [...regionFacts, ...placeFacts];
}

/** @deprecated используй loadMapFacts */
export const loadMapFoldFacts = loadMapFacts;
