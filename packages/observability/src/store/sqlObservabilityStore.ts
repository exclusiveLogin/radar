import type {
  ExecutorSnapshot,
  HostSnapshot,
  ObsIngestBatch,
  RuntimeObservabilitySnapshot,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "@radar/shared";
import type { Pool, PoolClient } from "pg";

/** Исполнитель SQL-запросов (pg Pool или transaction client). */
export type ObsQueryRunner = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

/** Преобразование timestamptz из Postgres в ISO-строку. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Upsert host в obs_hosts. */
export async function upsertHost(
  runner: ObsQueryRunner,
  host: HostSnapshot,
): Promise<void> {
  await runner.query(
    `INSERT INTO obs_hosts (host_id, role, started_at, last_seen_at, odp_runtime, metrics)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (host_id) DO UPDATE SET
       role = EXCLUDED.role,
       last_seen_at = EXCLUDED.last_seen_at,
       odp_runtime = EXCLUDED.odp_runtime,
       metrics = COALESCE(EXCLUDED.metrics, obs_hosts.metrics)`,
    [
      host.hostId,
      host.role,
      host.startedAt,
      host.lastSeenAt,
      JSON.stringify(host.odpRuntime),
      host.metrics ? JSON.stringify(host.metrics) : null,
    ],
  );
}

/** Upsert executor в obs_executors. */
export async function upsertExecutor(
  runner: ObsQueryRunner,
  executor: ExecutorSnapshot,
): Promise<void> {
  await runner.query(
    `INSERT INTO obs_executors (executor_id, host_id, kind, parent_id, last_seen_at, status, metrics)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (executor_id) DO UPDATE SET
       host_id = EXCLUDED.host_id,
       kind = EXCLUDED.kind,
       parent_id = EXCLUDED.parent_id,
       last_seen_at = EXCLUDED.last_seen_at,
       status = EXCLUDED.status,
       metrics = COALESCE(EXCLUDED.metrics, obs_executors.metrics)`,
    [
      executor.executorId,
      executor.hostId,
      executor.kind,
      executor.parentId ?? null,
      executor.lastSeenAt,
      executor.status,
      executor.metrics ? JSON.stringify(executor.metrics) : null,
    ],
  );
}

/** Upsert workload в obs_workloads. */
export async function upsertWorkload(
  runner: ObsQueryRunner,
  workload: WorkloadSnapshot,
): Promise<void> {
  await runner.query(
    `INSERT INTO obs_workloads (workload_id, host_id, pipeline_key, runtime, status, last_tick_at, metrics)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (workload_id) DO UPDATE SET
       host_id = EXCLUDED.host_id,
       pipeline_key = EXCLUDED.pipeline_key,
       runtime = EXCLUDED.runtime,
       status = EXCLUDED.status,
       last_tick_at = EXCLUDED.last_tick_at,
       metrics = COALESCE(EXCLUDED.metrics, obs_workloads.metrics)`,
    [
      workload.workloadId,
      workload.hostId,
      workload.pipelineKey,
      workload.runtime,
      workload.status,
      workload.lastTickAt ?? null,
      workload.metrics ? JSON.stringify(workload.metrics) : null,
    ],
  );
}

/** Инкремент trigger-счётчика. */
export async function incrementTrigger(
  runner: ObsQueryRunner,
  key: TriggerCounterKey,
  delta = 1,
): Promise<void> {
  await runner.query(
    `INSERT INTO obs_trigger_counters (pipeline_key, event_type, source, count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pipeline_key, event_type, source) DO UPDATE SET
       count = obs_trigger_counters.count + EXCLUDED.count`,
    [key.pipelineKey, key.eventType, key.source, delta],
  );
}

/** Инкремент materialize-счётчика. */
export async function recordMaterialize(
  runner: ObsQueryRunner,
  pipelineKey: string,
  delta = 1,
): Promise<void> {
  await runner.query(
    `INSERT INTO obs_materialize_counters (pipeline_key, count, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (pipeline_key) DO UPDATE SET
       count = obs_materialize_counters.count + EXCLUDED.count,
       updated_at = now()`,
    [pipelineKey, delta],
  );
}

/** SQL store: ingest batch + read snapshot + stale cleanup. */
export class SqlObservabilityStore {
  constructor(private readonly pool: Pool) {}

  /** Атомарная запись batch ingest. */
  async applyIngestBatch(batch: ObsIngestBatch): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runner: ObsQueryRunner = client;

      if (batch.host) await upsertHost(runner, batch.host);
      for (const executor of batch.executors) await upsertExecutor(runner, executor);
      for (const workload of batch.workloads) await upsertWorkload(runner, workload);
      for (const trigger of batch.triggers) {
        await incrementTrigger(runner, trigger.key, trigger.delta);
      }
      for (const entry of batch.materialize) {
        await recordMaterialize(runner, entry.pipelineKey, entry.delta);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Read-side snapshot для GET /obs/v1/runtime/snapshot. */
  async loadRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot> {
    const [hostsRes, executorsRes, workloadsRes, triggersRes, materializeRes] =
      await Promise.all([
        this.pool.query(
          `SELECT host_id, role, started_at, last_seen_at, odp_runtime, metrics FROM obs_hosts`,
        ),
        this.pool.query(
          `SELECT executor_id, host_id, kind, parent_id, last_seen_at, status, metrics FROM obs_executors`,
        ),
        this.pool.query(
          `SELECT workload_id, host_id, pipeline_key, runtime, status, last_tick_at, metrics FROM obs_workloads`,
        ),
        this.pool.query(
          `SELECT pipeline_key, event_type, source, count FROM obs_trigger_counters`,
        ),
        this.pool.query(
          `SELECT pipeline_key, count, updated_at FROM obs_materialize_counters`,
        ),
      ]);

    return {
      hosts: hostsRes.rows.map((row) => ({
        hostId: row.host_id,
        role: row.role,
        startedAt: toIso(row.started_at),
        lastSeenAt: toIso(row.last_seen_at),
        odpRuntime: row.odp_runtime ?? [],
        metrics: row.metrics ?? undefined,
      })),
      executors: executorsRes.rows.map((row) => ({
        executorId: row.executor_id,
        hostId: row.host_id,
        kind: row.kind,
        parentId: row.parent_id,
        lastSeenAt: toIso(row.last_seen_at),
        status: row.status,
        metrics: row.metrics ?? undefined,
      })),
      workloads: workloadsRes.rows.map((row) => ({
        workloadId: row.workload_id,
        hostId: row.host_id,
        pipelineKey: row.pipeline_key,
        runtime: row.runtime,
        status: row.status,
        lastTickAt: row.last_tick_at ? toIso(row.last_tick_at) : null,
        metrics: row.metrics ?? undefined,
      })),
      triggerCounters: triggersRes.rows.map((row) => ({
        pipelineKey: row.pipeline_key,
        eventType: row.event_type,
        source: row.source,
        count: Number(row.count),
      })),
      materializeCounters: materializeRes.rows.map((row) => ({
        pipelineKey: row.pipeline_key,
        count: Number(row.count),
        updatedAt: toIso(row.updated_at),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Удаление устаревших записей по last_seen_at / last_tick_at. */
  async purgeStale(cutoffIso: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM obs_executors WHERE last_seen_at < $1`,
      [cutoffIso],
    );
    await this.pool.query(
      `DELETE FROM obs_workloads WHERE last_tick_at IS NOT NULL AND last_tick_at < $1`,
      [cutoffIso],
    );
    await this.pool.query(
      `DELETE FROM obs_hosts WHERE last_seen_at < $1`,
      [cutoffIso],
    );
  }
}

/** Адаптер pg PoolClient для ObsQueryRunner. */
export function poolClientRunner(client: PoolClient): ObsQueryRunner {
  return {
    query: (sql, params) => client.query(sql, params),
  };
}
