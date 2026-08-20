/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Загрузка кандидатов для rebuild-пайплайна треков из БД.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  resolveThreatProfile,
  resolveNodeMode,
  trackingPipelineTypesSqlIn,
  canEnterPipeline,
  mergeCandidateWindow,
  TRACKING_PIPELINE_NOT_PROCESSED_SQL,
  withTrackingL1Transaction,
  type CandidateWindowLoad,
  type TrackingCandidate,
} from "@radar/shared";

const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

const PIPELINE_TYPES_IN = trackingPipelineTypesSqlIn();

const NOT_PROCESSED_SQL = TRACKING_PIPELINE_NOT_PROCESSED_SQL;

/** Worker: можно ли писать L1 (rebuild мог выключить пайплайн mid-tick). */
export async function isTrackingPipelineEnabled(ds: DataSource): Promise<boolean> {
  const [row] = await ds.query<{ enabled: boolean }[]>(
    `SELECT enabled FROM state_track_pipeline WHERE id = 'default'`,
  );
  return row?.enabled ?? false;
}

const CANDIDATES_FROM_SQL = `
    FROM mat_parse_location el
    JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
    LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
    LEFT JOIN status_dictionary sd ON sd.code = pe.event_type
    LEFT JOIN regions r ON r.id = el.region_id
    LEFT JOIN LATERAL (
      SELECT
        rf.centroid_lat::double precision AS nfl_lat,
        rf.centroid_lon::double precision AS nfl_lon
      FROM regions rf
      WHERE rf.front_region = true
        AND rf.centroid_lat IS NOT NULL
        AND rf.centroid_lon IS NOT NULL
      ORDER BY
        (el.lat::double precision - rf.centroid_lat::double precision) ^ 2
        + (el.lon::double precision - rf.centroid_lon::double precision) ^ 2
      LIMIT 1
    ) nfl ON true`;

const CANDIDATES_SELECT = `
    SELECT
      el.id                   AS event_location_id,
      pe.id                   AS parsed_event_id,
      pe.raw_message_id       AS raw_message_id,
      ${EVENT_AT_SQL} AS occurred_at,
      el.lat,
      el.lon,
      el.place_id,
      el.precision,
      el.confidence           AS trust,
      pe.event_type,
      pe.event_subject,
      pe.extras,
      sd.affects_kinematics,
      COALESCE(r.front_region, false) AS is_front_region,
      (el.region_id IS NOT NULL AND COALESCE(r.front_region, false) IS DISTINCT FROM true) AS is_interior_rf,
      r.front_distance_km AS front_distance_km,
      nfl.nfl_lat AS nearest_front_lat,
      nfl.nfl_lon AS nearest_front_lon`;

type LoadCandidatesOptions = {
  since: Date;
  until: Date;
  bbox?: [number, number, number, number];
  /** false — загрузить все (включая уже в nodes), для диагностики. */
  excludeConsumed?: boolean;
};

export async function loadTrackingCandidates(
  ds: DataSource,
  opts: LoadCandidatesOptions,
): Promise<TrackingCandidate[]> {
  const { since, until, bbox, excludeConsumed = true } = opts;

  const rows = await ds.query<RawRow[]>(
    `
    ${CANDIDATES_SELECT}
    ${CANDIDATES_FROM_SQL}
    WHERE
      ${EVENT_AT_SQL} BETWEEN $1 AND $2
      AND el.lat IS NOT NULL
      AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      AND pe.event_type IN (${PIPELINE_TYPES_IN})
      ${excludeConsumed ? NOT_PROCESSED_SQL : ""}
      ${bbox ? `AND el.lon BETWEEN ${bbox[0]} AND ${bbox[2]} AND el.lat BETWEEN ${bbox[1]} AND ${bbox[3]}` : ""}
    ORDER BY ${EVENT_AT_SQL} ASC
    `,
    [since.toISOString(), until.toISOString()],
  );

  return rows.map(toCandidate).filter(canEnterPipeline);
}

type BatchOptions = {
  until: Date;
  limit: number;
  excludeConsumed?: boolean;
};

type PendingOptions = {
  until: Date;
  /** Bounded page: размер очереди не должен определять стоимость одного tick. */
  limit?: number;
};

/** Стабильная event-time страница необработанной pipeline-очереди. */
export async function loadPendingTrackingCandidates(
  ds: DataSource,
  opts: PendingOptions,
): Promise<TrackingCandidate[]> {
  const rows = await ds.query<RawRow[]>(
    `
    ${CANDIDATES_SELECT}
    ${CANDIDATES_FROM_SQL}
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND el.lat IS NOT NULL
      AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      AND pe.event_type IN (${PIPELINE_TYPES_IN})
      ${NOT_PROCESSED_SQL}
      AND NOT EXISTS (
        SELECT 1 FROM state_track_strobe_member staged
        WHERE staged.event_location_id = el.id
      )
    ORDER BY ${EVENT_AT_SQL} ASC, el.id ASC
    LIMIT $2
    `,
    [opts.until.toISOString(), opts.limit ?? 20_000],
  );

  return rows.map(toCandidate).filter(canEnterPipeline);
}

/** Загружает полный накопленный состав одного persisted strobe. */
export async function loadTrackingStrobeCandidates(
  ds: DataSource,
  strobeId: string,
): Promise<TrackingCandidate[]> {
  const rows = await ds.query<RawRow[]>(
    `
    ${CANDIDATES_SELECT}
    ${CANDIDATES_FROM_SQL}
    JOIN state_track_strobe_member member ON member.event_location_id = el.id
    WHERE member.strobe_id = $1
    ORDER BY ${EVENT_AT_SQL} ASC, el.id ASC
    `,
    [strobeId],
  );
  return rows.map(toCandidate).filter(canEnterPipeline);
}

/** Загрузка кандидатов по id (phase B: winners page). */
export async function loadTrackingCandidatesByIds(
  ds: DataSource,
  eventLocationIds: readonly string[],
): Promise<TrackingCandidate[]> {
  if (eventLocationIds.length === 0) return [];
  const rows = await ds.query<RawRow[]>(
    `
    ${CANDIDATES_SELECT}
    ${CANDIDATES_FROM_SQL}
    WHERE el.id = ANY($1::uuid[])
    ORDER BY ${EVENT_AT_SQL} ASC, el.id ASC
    `,
    [eventLocationIds],
  );
  return rows.map(toCandidate).filter(canEnterPipeline);
}

const CONSUMED_ANCHOR_SQL = `
  AND EXISTS (
    SELECT 1 FROM state_track_consumed tpc
    WHERE tpc.event_location_id = el.id
  )`;

type CandidateWindowOptions = {
  until: Date;
  limit: number;
  /** Окно ε_temporal (мс) — lookback от min(pending) для consumed-якорей. */
  lookbackMs: number;
};

/**
 * Candidate window: bounded pending page + consumed anchors around its event-time frontier.
 * Состав окна зависит от event-time, а не от общего размера очереди.
 */
export async function loadCandidateWindow(
  ds: DataSource,
  opts: CandidateWindowOptions,
): Promise<CandidateWindowLoad> {
  const pending = await loadPendingTrackingCandidates(ds, {
    until: opts.until,
    limit: opts.limit,
  });
  if (pending.length === 0) {
    return { pending: [], window: [], lookbackMs: opts.lookbackMs };
  }

  const minAt = pending[0]!.occurredAt.getTime();
  const lookbackSince = new Date(minAt - opts.lookbackMs);

  const anchorRows = await ds.query<RawRow[]>(
    `
    ${CANDIDATES_SELECT}
    ${CANDIDATES_FROM_SQL}
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND ${EVENT_AT_SQL} >= $2
      AND el.lat IS NOT NULL
      AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      AND pe.event_type IN (${PIPELINE_TYPES_IN})
      ${CONSUMED_ANCHOR_SQL}
    ORDER BY ${EVENT_AT_SQL} ASC, el.id ASC
    `,
    [opts.until.toISOString(), lookbackSince.toISOString()],
  );

  const anchors = anchorRows.map(toCandidate).filter(canEnterPipeline);
  const window = mergeCandidateWindow(pending, anchors);

  return { pending, window, lookbackMs: opts.lookbackMs };
}

/** @deprecated Используй loadCandidateWindow / loadPendingTrackingCandidates. */
export async function loadTrackingCandidatesBatch(
  ds: DataSource,
  opts: BatchOptions,
): Promise<TrackingCandidate[]> {
  return loadPendingTrackingCandidates(ds, opts);
}

type CountRemainingOptions = {
  until: Date;
  excludeConsumed?: boolean;
};

const REMAINING_FROM_SQL = `
  FROM mat_parse_location el
  JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
  LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id`;

const REMAINING_WHERE_SQL = `
  WHERE
    ${EVENT_AT_SQL} <= $1
    AND el.lat IS NOT NULL
    AND el.lon IS NOT NULL
    AND pe.is_active IS DISTINCT FROM false
    AND pe.event_type IN (${PIPELINE_TYPES_IN})`;

/** Необработанные pipeline-кандидаты — очередь rebuild. */
export async function countTrackingPipelineRemaining(
  ds: DataSource,
  opts: CountRemainingOptions,
): Promise<number> {
  const excludeConsumed = opts.excludeConsumed !== false;

  const [{ count }] = await ds.query<{ count: string }[]>(
    `
    SELECT COUNT(*)::text AS count
    ${REMAINING_FROM_SQL}
    ${REMAINING_WHERE_SQL}
      ${excludeConsumed ? NOT_PROCESSED_SQL : ""}
    `,
    [opts.until.toISOString()],
  );
  return Number(count);
}

/**
 * Тот же предикат, что и в count, но с ранним выходом: полный COUNT сканирует всю
 * mat_parse_location (~13 c на архиве), а для «остались ли ещё точки» хватает первой строки.
 */
export async function hasPendingTrackingCandidates(
  ds: DataSource,
  opts: { until: Date },
): Promise<boolean> {
  const rows = await ds.query<{ exists: number }[]>(
    `
    SELECT 1 AS exists
    ${REMAINING_FROM_SQL}
    ${REMAINING_WHERE_SQL}
      ${NOT_PROCESSED_SQL}
    LIMIT 1
    `,
    [opts.until.toISOString()],
  );
  return rows.length > 0;
}

/** Помечает точки как обработанные пайплайном (внутри L1 xact). */
export async function markPipelineCandidatesConsumedTx(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  eventLocationIds: string[],
  reason = "batch",
): Promise<void> {
  if (eventLocationIds.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < eventLocationIds.length; i += chunkSize) {
    const chunk = eventLocationIds.slice(i, i + chunkSize);
    await query(
      `INSERT INTO state_track_consumed (event_location_id, reason)
       SELECT unnest($1::uuid[]), $2
       ON CONFLICT (event_location_id) DO NOTHING`,
      [chunk, reason],
    );
  }
}

/** Помечает точки как обработанные пайплайном (отдельный L1 write). */
export async function markPipelineCandidatesConsumed(
  ds: DataSource,
  eventLocationIds: string[],
  reason = "batch",
): Promise<void> {
  if (eventLocationIds.length === 0) return;
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    query => markPipelineCandidatesConsumedTx(query, eventLocationIds, reason),
  );
}

export async function countTrackingCandidates(ds: DataSource, until: Date): Promise<number> {
  const [{ count }] = await ds.query<{ count: string }[]>(
    `
    SELECT COUNT(*)::text AS count
    FROM mat_parse_location el
    JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
    LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND el.lat IS NOT NULL AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
    `,
    [until.toISOString()],
  );
  return Number(count);
}

export type TrackingCandidateStats = {
  totalCandidatesGeo: number;
  totalTargetCandidates: number;
  nodesInTracks: number;
  tracksActive: number;
  tracksClosed: number;
  tracksStale: number;
  tracksTotal: number;
  attentionConflicts?: number;
  softAssigns?: number;
};

export async function countTrackingCandidateStats(
  ds: DataSource,
  until: Date,
): Promise<TrackingCandidateStats> {
  const totalCandidatesGeo = await countTrackingCandidates(ds, until);

  const [{ count: targetCount }] = await ds.query<{ count: string }[]>(
    `
    SELECT COUNT(*)::text AS count
    FROM mat_parse_location el
    JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
    LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND el.lat IS NOT NULL AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      AND pe.event_type IN (${PIPELINE_TYPES_IN})
    `,
    [until.toISOString()],
  );

  const [{ nodes }] = await ds.query<{ nodes: string }[]>(
    `SELECT COUNT(*)::text AS nodes FROM mat_track_node`,
  );

  const trackRows = await ds.query<{ status: string; count: string }[]>(
    `SELECT status, COUNT(*)::text AS count FROM mat_track GROUP BY status`,
  );

  const byStatus = Object.fromEntries(trackRows.map(r => [r.status, Number(r.count)]));
  const tracksActive = byStatus.active ?? 0;
  const tracksClosed = byStatus.closed ?? 0;
  const tracksStale = byStatus.stale ?? 0;

  return {
    totalCandidatesGeo,
    totalTargetCandidates: Number(targetCount),
    nodesInTracks: Number(nodes),
    tracksActive,
    tracksClosed,
    tracksStale,
    tracksTotal: tracksActive + tracksClosed + tracksStale,
  };
}

type RawRow = {
  event_location_id: string;
  parsed_event_id: string;
  raw_message_id: string;
  occurred_at: string;
  lat: number | null;
  lon: number | null;
  place_id: string | null;
  precision: string;
  trust: number | null;
  event_type: string;
  event_subject: string | null;
  extras: Record<string, unknown> | null;
  affects_kinematics: boolean | null;
  is_front_region: boolean;
  is_interior_rf: boolean;
  front_distance_km: number | null;
  nearest_front_lat: number | null;
  nearest_front_lon: number | null;
};

function toCandidate(row: RawRow): TrackingCandidate {
  const threatProfile = resolveThreatProfile({
    eventType: row.event_type,
    eventSubject: row.event_subject,
  });

  const mode = resolveNodeMode({
    eventType: row.event_type,
    eventCategory: null,
    affectsKinematics: row.affects_kinematics,
    lat: row.lat,
    lon: row.lon,
  });

  return {
    eventLocationId: row.event_location_id,
    parsedEventId: row.parsed_event_id,
    occurredAt: new Date(row.occurred_at),
    lat: row.lat!,
    lon: row.lon!,
    placeId: row.place_id,
    precision: row.precision ?? "unknown",
    trust: row.trust ?? 0.5,
    eventType: row.event_type,
    eventCategory: null,
    affectsKinematics: row.affects_kinematics,
    isFrontRegion: row.is_front_region,
    isInteriorRf: row.is_interior_rf,
    frontDistanceKm: row.front_distance_km,
    nearestFrontLat: row.nearest_front_lat,
    nearestFrontLon: row.nearest_front_lon,
    threatProfile,
    mode,
    sourceRefs: [
      {
        eventLocationId: row.event_location_id,
        parsedEventId: row.parsed_event_id,
        rawMessageId: row.raw_message_id,
      },
    ],
  };
}
