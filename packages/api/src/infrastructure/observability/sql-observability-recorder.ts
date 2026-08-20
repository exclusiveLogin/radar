import type {
  ExecutorSnapshot,
  HostSnapshot,
  IObservabilityRecorder,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "@radar/shared";
import type { DataSource } from "typeorm";

/** Embedded SQL write-path: upsert в obs_* таблицы. */
export class SqlObservabilityRecorder implements IObservabilityRecorder {
  constructor(private readonly dataSource: DataSource) {}

  async upsertHost(host: HostSnapshot): Promise<void> {
    await this.dataSource.query(
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

  async upsertExecutor(executor: ExecutorSnapshot): Promise<void> {
    await this.dataSource.query(
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

  async upsertWorkload(workload: WorkloadSnapshot): Promise<void> {
    await this.dataSource.query(
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

  async incrementTrigger(key: TriggerCounterKey, delta = 1): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO obs_trigger_counters (pipeline_key, event_type, source, count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pipeline_key, event_type, source) DO UPDATE SET
         count = obs_trigger_counters.count + EXCLUDED.count`,
      [key.pipelineKey, key.eventType, key.source, delta],
    );
  }

  async recordMaterialize(pipelineKey: string, delta = 1): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO obs_materialize_counters (pipeline_key, count, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (pipeline_key) DO UPDATE SET
         count = obs_materialize_counters.count + EXCLUDED.count,
         updated_at = now()`,
      [pipelineKey, delta],
    );
  }
}
