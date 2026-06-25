/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Загрузка кандидатов для rebuild-пайплайна треков из БД.
 *          Выбираем event_locations + parsed_events в временном окне,
 *          обогащаем is_front_region, threat_profile, аффектус кинематики.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  resolveThreatProfile,
  resolveNodeMode,
  trackingTargetEventTypesSqlIn,
  type TrackingCandidate,
  type TrackingWatermark,
} from "@radar/shared";

/** SSOT выражения времени события — как в map-query.service. */
const EVENT_AT_SQL = "COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at)";

const CANDIDATES_FROM_SQL = `
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
    LEFT JOIN status_dictionary sd ON sd.code = pe.event_type`;

type LoadCandidatesOptions = {
  since: Date;
  until: Date;
  /** Опционально ограничить по bbox: [minLon, minLat, maxLon, maxLat]. */
  bbox?: [number, number, number, number];
};

/**
 * Загружает и нормализует кандидатов для tracking rebuild.
 *
 * SQL сортирует по occurred_at ASC — гарантирует хронологический порядок для Kalman.
 * Включает только события с coords или placeId (есть геолокация для трека).
 */
export async function loadTrackingCandidates(
  ds: DataSource,
  opts: LoadCandidatesOptions,
): Promise<TrackingCandidate[]> {
  const { since, until, bbox } = opts;

  const rows = await ds.query<RawRow[]>(
    `
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
      false AS is_front_region
    ${CANDIDATES_FROM_SQL}
    WHERE
      ${EVENT_AT_SQL} BETWEEN $1 AND $2
      AND el.lat IS NOT NULL
      AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      ${bbox ? `AND el.lon BETWEEN ${bbox[0]} AND ${bbox[2]} AND el.lat BETWEEN ${bbox[1]} AND ${bbox[3]}` : ""}
    ORDER BY ${EVENT_AT_SQL} ASC
    `,
    [since.toISOString(), until.toISOString()],
  );

  return rows.map(toCandidate);
}

type BatchOptions = {
  after?: TrackingWatermark | null;
  until: Date;
  limit: number;
  /** Overlap для ST-DBSCAN на границе батча. */
  overlapMs: number;
};

/**
 * Инкрементальная загрузка кандидатов после watermark с overlap-окном.
 */
export async function loadTrackingCandidatesBatch(
  ds: DataSource,
  opts: BatchOptions,
): Promise<TrackingCandidate[]> {
  const overlapSince = opts.after?.lastOccurredAt
    ? new Date(new Date(opts.after.lastOccurredAt).getTime() - opts.overlapMs)
    : new Date(0);

  const rows = await ds.query<RawRow[]>(
    `
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
      false AS is_front_region
    ${CANDIDATES_FROM_SQL}
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND (
        $2::timestamptz IS NULL
        OR ${EVENT_AT_SQL} > $2
        OR (
          ${EVENT_AT_SQL} = $2
          AND el.id > $3::uuid
        )
      )
      AND ${EVENT_AT_SQL} >= $4
      AND el.lat IS NOT NULL
      AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
    ORDER BY ${EVENT_AT_SQL} ASC, el.id ASC
    LIMIT $5
    `,
    [
      opts.until.toISOString(),
      opts.after?.lastOccurredAt ?? null,
      opts.after?.lastEventLocationId ?? "00000000-0000-0000-0000-000000000000",
      overlapSince.toISOString(),
      opts.limit,
    ],
  );

  return rows.map(toCandidate);
}

/** Подсчёт кандидатов для progress bar. */
export async function countTrackingCandidates(ds: DataSource, until: Date): Promise<number> {
  const [{ count }] = await ds.query<{ count: string }[]>(
    `
    SELECT COUNT(*)::text AS count
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
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
};

/** Сводка для админки: гео-точки, целевые типы, треки в БД. */
export async function countTrackingCandidateStats(
  ds: DataSource,
  until: Date,
): Promise<TrackingCandidateStats> {
  const totalCandidatesGeo = await countTrackingCandidates(ds, until);

  const targetIn = trackingTargetEventTypesSqlIn();
  const [{ count: targetCount }] = await ds.query<{ count: string }[]>(
    `
    SELECT COUNT(*)::text AS count
    FROM event_locations el
    JOIN parsed_events pe ON pe.id = el.parsed_event_id
    LEFT JOIN raw_messages rm ON rm.id = pe.raw_message_id
    WHERE
      ${EVENT_AT_SQL} <= $1
      AND el.lat IS NOT NULL AND el.lon IS NOT NULL
      AND pe.is_active IS DISTINCT FROM false
      AND pe.event_type IN (${targetIn})
    `,
    [until.toISOString()],
  );

  const [{ nodes }] = await ds.query<{ nodes: string }[]>(
    `SELECT COUNT(*)::text AS nodes FROM trajectory_nodes`,
  );

  const trackRows = await ds.query<{ status: string; count: string }[]>(
    `SELECT status, COUNT(*)::text AS count FROM trajectory_tracks GROUP BY status`,
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
