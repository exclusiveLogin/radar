/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: Persisted event-time strobe membership and lifecycle.
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

/** Первый strobe без materialized winner: единственная точка входа provisional replay. */
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

/** Open strobes, закрываемые timer/frontier на данном tick. */
export async function loadReadyTrackingStrobes(
  ds: DataSource,
  frontier: Date,
): Promise<TrackingStrobe[]> {
  const rows = await ds.query<StrobeRow[]>(
    `SELECT id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot
     FROM state_track_strobe
     WHERE status = 'open'
       AND winner_event_location_ids <> '[]'::jsonb
       AND closes_at < $1
     ORDER BY first_at ASC, id ASC`,
    [frontier.toISOString()],
  );
  return rows.map(toStrobe).filter(strobe => isTrackingStrobeReady(
    { firstOccurredAt: strobe.firstAt, closesAt: strobe.closesAt },
    frontier,
  ));
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

/** Закрывает уже materialized strobe без повторного обучения FlowMap. */
export async function finalizeTrackingStrobeAtomically(
  ds: DataSource,
  strobeId: string,
): Promise<void> {
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    query => finalizeTrackingStrobe(query, strobeId),
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
             flow_snapshot = $3::jsonb,
             updated_at = now()
         WHERE id = 'default'`,
        [
          boundary,
          strobe.id,
          JSON.stringify(prefix?.flow_snapshot ?? { vectors: {}, mass: {} }),
        ],
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

async function resolveStrobe(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  candidate: TrackingCandidate,
  config: TrackingPipelineConfig,
): Promise<TrackingStrobe> {
  const rows = await query(
    `SELECT id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot
     FROM state_track_strobe
     WHERE threat_profile = $1
       AND first_at <= $2
       AND closes_at >= $2
     ORDER BY first_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [candidate.threatProfile, candidate.occurredAt.toISOString()],
  ) as StrobeRow[];
  if (rows[0]) return toStrobe(rows[0]);

  const bounds = createTrackingStrobeBounds(candidate.occurredAt, config.strobe);
  const [created] = await query(
    `INSERT INTO state_track_strobe (threat_profile, first_at, closes_at, status)
     VALUES ($1, $2, $3, 'open')
     RETURNING id, first_at, closes_at, status, winner_event_location_ids, flow_snapshot`,
    [candidate.threatProfile, bounds.firstOccurredAt.toISOString(), bounds.closesAt.toISOString()],
  ) as StrobeRow[];
  return toStrobe(created!);
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
