/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: Persisted event-time strobe membership and lifecycle (grid bins).
 * ---
 */
import type { DataSource } from "typeorm";
import {
  createTrackingStrobeBounds,
  isTrackingStrobeReady,
  withTrackingL1Transaction,
  type FlowMapSnapshot,
  type TrackingCandidate,
  type TrackingPipelineConfig,
  type TrackingWatermark,
} from "@radar/shared";

export type TrackingStrobe = {
  id: string;
  firstAt: Date;
  closesAt: Date;
  status: "open" | "final";
  winnerEventLocationIds: string[];
  flowSnapshot: FlowMapSnapshot | null;
};

/** Назначает bounded page существующим или новым strobe без зависимости от batch size. */
export async function stageTrackingCandidates(
  ds: DataSource,
  candidates: readonly TrackingCandidate[],
  config: TrackingPipelineConfig,
): Promise<string[]> {
  if (candidates.length === 0) return [];

  return withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    async query => {
      const changed = new Set<string>();
      for (const candidate of candidates) {
        const strobe = await resolveStrobe(query, candidate, config);
        const inserted = await query(
          `INSERT INTO state_track_strobe_member (event_location_id, strobe_id, occurred_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_location_id) DO NOTHING
           RETURNING event_location_id`,
          [candidate.eventLocationId, strobe.id, candidate.occurredAt.toISOString()],
        ) as Array<{ event_location_id: string }>;
        if (inserted.length === 0) continue;
        await query(
          `UPDATE state_track_strobe
           SET winner_event_location_ids = '[]'::jsonb, updated_at = now()
           WHERE id = $1`,
          [strobe.id],
        );
        changed.add(strobe.id);
      }
      return [...changed];
    },
  );
}

/** Первый strobe без materialized winner: точка входа phase A (cluster). */
export async function loadDirtyTrackingStrobe(ds: DataSource): Promise<TrackingStrobe | null> {
  const [row] = await ds.query<StrobeRow[]>(
    `SELECT id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot
     FROM state_track_strobe
     WHERE winner_event_location_ids = '[]'::jsonb
     ORDER BY first_at ASC, id ASC
     LIMIT 1`,
  );
  return row ? toStrobe(row) : null;
}

/** Open strobes, закрываемые timer/frontier после того, как phase B забрала всех winners. */
export async function loadReadyTrackingStrobes(
  ds: DataSource,
  frontier: Date,
): Promise<TrackingStrobe[]> {
  const rows = await ds.query<StrobeRow[]>(
    `SELECT id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot
     FROM state_track_strobe s
     WHERE status = 'open'
       AND winner_event_location_ids <> '[]'::jsonb
       AND closes_at <= $1
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements_text(s.winner_event_location_ids) AS w(id)
         WHERE NOT EXISTS (
           SELECT 1 FROM state_track_consumed c
           WHERE c.event_location_id = w.id::uuid
         )
       )
     ORDER BY first_at ASC, id ASC`,
    [frontier.toISOString()],
  );
  return rows.map(toStrobe).filter(strobe => isTrackingStrobeReady(
    { firstOccurredAt: strobe.firstAt, closesAt: strobe.closesAt },
    frontier,
  ));
}

/**
 * Строб, чьи точки удалены parse rebuild, данных не несёт и не может получить winner —
 * без удаления он навсегда остаётся dirty и блокирует очередь. Члены уходят каскадом.
 */
export async function deleteTrackingStrobe(ds: DataSource, strobeId: string): Promise<void> {
  await ds.query(`DELETE FROM state_track_strobe WHERE id = $1`, [strobeId]);
}

/** Остались ли стробы к обработке: dirty (без winner) либо закрытые по frontier. */
export async function hasUnprocessedTrackingStrobes(
  ds: DataSource,
  frontier: Date,
): Promise<boolean> {
  const rows = await ds.query<{ exists: number }[]>(
    `SELECT 1 AS exists
     FROM state_track_strobe
     WHERE winner_event_location_ids = '[]'::jsonb
        OR (status = 'open' AND closes_at <= $1)
     LIMIT 1`,
    [frontier.toISOString()],
  );
  return rows.length > 0;
}

/**
 * Есть ли winners, ещё не прошедшие phase B (join): materialized strobe, id не в consumed.
 * Курсор join — watermark пайплайна, не граница строба.
 */
export async function hasPendingJoinWinners(ds: DataSource): Promise<boolean> {
  const rows = await ds.query<{ exists: number }[]>(
    `SELECT 1 AS exists
     FROM state_track_strobe s
     CROSS JOIN LATERAL jsonb_array_elements_text(s.winner_event_location_ids) AS w(id)
     WHERE s.winner_event_location_ids <> '[]'::jsonb
       AND NOT EXISTS (
         SELECT 1 FROM state_track_consumed c
         WHERE c.event_location_id = w.id::uuid
       )
     LIMIT 1`,
  );
  return rows.length > 0;
}

/**
 * Следующая страница winner id по event-time курсору (watermark).
 * Батч — только перфоманс; окно алгоритма join задаётся seeds as-of + maxGapMs.
 */
export async function loadJoinWinnerIds(
  ds: DataSource,
  watermark: TrackingWatermark | null,
  limit: number,
): Promise<string[]> {
  const rows = watermark
    ? await ds.query<{ event_location_id: string }[]>(
      `SELECT el.id AS event_location_id
       FROM state_track_strobe s
       CROSS JOIN LATERAL jsonb_array_elements_text(s.winner_event_location_ids) AS w(id)
       JOIN mat_parse_location el ON el.id = w.id::uuid
       LEFT JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
       LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       WHERE s.winner_event_location_ids <> '[]'::jsonb
         AND NOT EXISTS (
           SELECT 1 FROM state_track_consumed c
           WHERE c.event_location_id = el.id
         )
         AND (
           COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at),
           el.id
         ) > ($1::timestamptz, $2::uuid)
       ORDER BY COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) ASC, el.id ASC
       LIMIT $3`,
      [watermark.lastOccurredAt, watermark.lastEventLocationId, limit],
    )
    : await ds.query<{ event_location_id: string }[]>(
      `SELECT el.id AS event_location_id
       FROM state_track_strobe s
       CROSS JOIN LATERAL jsonb_array_elements_text(s.winner_event_location_ids) AS w(id)
       JOIN mat_parse_location el ON el.id = w.id::uuid
       LEFT JOIN mat_parse_event pe ON pe.id = el.parsed_event_id
       LEFT JOIN mat_ingest_raw rm ON rm.id = pe.raw_message_id
       WHERE s.winner_event_location_ids <> '[]'::jsonb
         AND NOT EXISTS (
           SELECT 1 FROM state_track_consumed c
           WHERE c.event_location_id = el.id
         )
       ORDER BY COALESCE(el.occurred_at, rm.posted_at, pe.parsed_at) ASC, el.id ASC
       LIMIT $1`,
      [limit],
    );
  return rows.map(row => row.event_location_id);
}

/** Финализация выполняется в checkpoint-транзакции после materialize. */
export async function finalizeTrackingStrobe(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  strobeId: string,
): Promise<void> {
  await query(
    `UPDATE state_track_strobe
     SET status = 'final', updated_at = now()
     WHERE id = $1 AND status = 'open'`,
    [strobeId],
  );
}

/** Закрывает уже materialized strobe и фиксирует FlowMap после phase B. */
export async function finalizeTrackingStrobeAtomically(
  ds: DataSource,
  strobeId: string,
): Promise<void> {
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    async query => {
      const [pipeline] = await query(
        `SELECT flow_snapshot FROM state_track_pipeline WHERE id = 'default'`,
      ) as Array<{ flow_snapshot: FlowMapSnapshot | null }>;
      await query(
        `UPDATE state_track_strobe
         SET status = 'final',
             flow_snapshot = COALESCE($2::jsonb, flow_snapshot),
             updated_at = now()
         WHERE id = $1 AND status = 'open'`,
        [strobeId, JSON.stringify(pipeline?.flow_snapshot ?? { vectors: {}, mass: {} })],
      );
    },
  );
}

/**
 * Откатывает materialized tail к checkpoint перед изменённым strobe.
 * Snapshot предыдущего strobe содержит ровно тот FlowMap, который существовал
 * до его successor; пересчёт не теряет влияние неизменного prefix.
 */
export async function resetTrackingStrobeTail(
  ds: DataSource,
  strobe: TrackingStrobe,
): Promise<void> {
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    async query => {
      const [prefix] = await query(
        `SELECT flow_snapshot
         FROM state_track_strobe
         WHERE flow_snapshot IS NOT NULL
           AND (first_at, id) < ($1::timestamptz, $2::uuid)
         ORDER BY first_at DESC, id DESC
         LIMIT 1`,
        [strobe.firstAt.toISOString(), strobe.id],
      ) as Array<{ flow_snapshot: FlowMapSnapshot }>;
      const boundary = strobe.firstAt.toISOString();

      await query(
        `DELETE FROM mat_track
         WHERE last_at >= $1`,
        [boundary],
      );
      await query(
        `DELETE FROM state_track_consumed consumed
         USING state_track_strobe_member member
         JOIN state_track_strobe affected ON affected.id = member.strobe_id
         WHERE consumed.event_location_id = member.event_location_id
           AND (affected.first_at, affected.id) >= ($1::timestamptz, $2::uuid)`,
        [boundary, strobe.id],
      );
      await query(
        `UPDATE state_track_strobe
         SET status = 'open',
             winner_event_location_ids = '[]'::jsonb,
             flow_snapshot = NULL,
             replay_from = $1,
             updated_at = now()
         WHERE (first_at, id) >= ($1::timestamptz, $2::uuid)`,
        [boundary, strobe.id],
      );
      await query(
        `UPDATE state_track_pipeline
         SET watermark = '{}'::jsonb,
             flow_snapshot = $1::jsonb,
             updated_at = now()
         WHERE id = 'default'`,
        [JSON.stringify(prefix?.flow_snapshot ?? { vectors: {}, mass: {} })],
      );
    },
  );
}

type StrobeRow = {
  id: string;
  first_at: Date | string;
  closes_at: Date | string;
  status: "open" | "final";
  winner_event_location_ids?: string[];
  flow_snapshot?: FlowMapSnapshot | null;
};

/**
 * Идемпотентный upsert бина (threat_profile, first_at).
 * Границы считает createTrackingStrobeBounds — точка сама определяет свой бин.
 */
async function resolveStrobe(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  candidate: TrackingCandidate,
  config: TrackingPipelineConfig,
): Promise<TrackingStrobe> {
  const bounds = createTrackingStrobeBounds(candidate.occurredAt, config.strobe);
  const [created] = await query(
    `INSERT INTO state_track_strobe (threat_profile, first_at, closes_at, status)
     VALUES ($1, $2, $3, 'open')
     ON CONFLICT (threat_profile, first_at) DO NOTHING
     RETURNING id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot`,
    [
      candidate.threatProfile,
      bounds.firstOccurredAt.toISOString(),
      bounds.closesAt.toISOString(),
    ],
  ) as StrobeRow[];
  if (created) return toStrobe(created);

  const [existing] = await query(
    `SELECT id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot
     FROM state_track_strobe
     WHERE threat_profile = $1 AND first_at = $2
     LIMIT 1`,
    [candidate.threatProfile, bounds.firstOccurredAt.toISOString()],
  ) as StrobeRow[];
  if (!existing) {
    throw new Error(
      `resolveStrobe: bin missing after upsert (${candidate.threatProfile}, ${bounds.firstOccurredAt.toISOString()})`,
    );
  }
  return toStrobe(existing);
}

function toStrobe(row: StrobeRow): TrackingStrobe {
  return {
    id: row.id,
    firstAt: new Date(row.first_at),
    closesAt: new Date(row.closes_at),
    status: row.status,
    winnerEventLocationIds: row.winner_event_location_ids ?? [],
    flowSnapshot: row.flow_snapshot ?? null,
  };
}
