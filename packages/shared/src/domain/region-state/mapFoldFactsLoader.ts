import type { StateLevel } from "../../schemas/geo/state-level";
import type { EventLocationFact } from "./mapStateFold";
import { shouldIncomingBeatWinner } from "./mapStateFold";
import type { MapStatusAction } from "./statusEventOrdering";
import {
  isMassClearTextEligible,
  resolveMassClearTargets,
  type MassClearRegionRef,
} from "./massClearTargets";

/** Минимальный контракт БД для загрузки фактов fold (TypeORM DataSource и worker DS). */
export type MapFoldDbQuery = {
  query<T = unknown>(sql: string, parameters?: unknown[]): Promise<T>;
};

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

async function loadLocationFacts(
  db: MapFoldDbQuery,
  asOf: Date,
  cutoff: Date,
): Promise<EventLocationFact[]> {
  const rows = (await db.query(
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
  )) as FactRow[];

  return rows.map(toFact);
}

/**
 * Глобальный отбой без locations: синтетические clear по регионам канала с raise за 24ч до clear.
 */
async function loadChannelClearFacts(
  db: MapFoldDbQuery,
  asOf: Date,
  cutoff: Date,
): Promise<EventLocationFact[]> {
  const rows = (await db.query(
    `
    WITH global_clears AS (
      SELECT pe.id AS parsed_event_id,
             rm.posted_at AS clear_at,
             c.key AS channel_key
      FROM parsed_events pe
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id
      WHERE (pe.event_type = 'cleared' OR pe.is_active = false)
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
    ORDER BY gc.parsed_event_id, el.region_id, el.occurred_at DESC
    `,
    [asOf.toISOString(), cutoff.toISOString()],
  )) as SyntheticClearRow[];

  return rows.map((row) => toRegionClearFact(row, "synthetic-channel-clear"));
}

/** Групповой отбой из raw_text (resolveClearTargets). */
async function loadMassClearFacts(
  db: MapFoldDbQuery,
  asOf: Date,
  cutoff: Date,
  regions: MassClearRegionRef[],
): Promise<EventLocationFact[]> {
  const rows = (await db.query(
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
  )) as MassClearCandidateRow[];

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
  const rows = (await db.query(
    `
    SELECT id, iso, name, name_with_type, short_name
    FROM regions
    WHERE is_active = true
    `,
  )) as Array<{
    id: string;
    iso: string | null;
    name: string;
    name_with_type: string | null;
    short_name: string | null;
  }>;

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

/** Полная загрузка фактов для fold: locations + синтетики mass/channel/place-clear. */
export async function loadMapFoldFacts(
  db: MapFoldDbQuery,
  asOf: Date,
  ttlMs: number,
): Promise<EventLocationFact[]> {
  const cutoff = new Date(asOf.getTime() - ttlMs);
  const [locationFacts, regions] = await Promise.all([
    loadLocationFacts(db, asOf, cutoff),
    loadActiveRegions(db),
  ]);
  const [massClearFacts, channelClearFacts] = await Promise.all([
    loadMassClearFacts(db, asOf, cutoff, regions),
    loadChannelClearFacts(db, asOf, cutoff),
  ]);

  const regionClears = collectRegionClearFacts([
    ...locationFacts,
    ...massClearFacts,
    ...channelClearFacts,
  ]);
  const placeRaiseFacts = locationFacts.filter(
    (fact) => fact.placeId && fact.entityKind !== "region",
  );
  const authorPlaceClearFacts = buildAuthorPlaceClearFacts(regionClears, placeRaiseFacts);

  return [
    ...locationFacts,
    ...massClearFacts,
    ...channelClearFacts,
    ...authorPlaceClearFacts,
  ];
}
