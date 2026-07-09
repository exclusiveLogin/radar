import {
  runtimeObservabilitySnapshotSchema,
  type RuntimeObservabilitySnapshot,
} from "@radar/shared";
import type { DataSource } from "typeorm";

/** Преобразование timestamptz из Postgres в ISO-строку. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** SQL read-client: obs_* таблицы через TypeORM DataSource (embedded mode). */
export class SqlObsReadClient {
  constructor(private readonly dataSource: DataSource) {}

  /** Read-side snapshot — зеркало SqlObservabilityStore.loadRuntimeSnapshot. */
  async fetchRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot> {
    const [hostsRes, executorsRes, workloadsRes, triggersRes, materializeRes] =
      await Promise.all([
        this.dataSource.query(
          `SELECT host_id, role, started_at, last_seen_at, odp_runtime, metrics FROM obs_hosts`,
        ),
        this.dataSource.query(
          `SELECT executor_id, host_id, kind, parent_id, last_seen_at, status, metrics FROM obs_executors`,
        ),
        this.dataSource.query(
          `SELECT workload_id, host_id, pipeline_key, runtime, status, last_tick_at, metrics FROM obs_workloads`,
        ),
        this.dataSource.query(
          `SELECT pipeline_key, event_type, source, count FROM obs_trigger_counters`,
        ),
        this.dataSource.query(
          `SELECT pipeline_key, count, updated_at FROM obs_materialize_counters`,
        ),
      ]);

    const snapshot: RuntimeObservabilitySnapshot = {
      hosts: hostsRes.map((row: Record<string, unknown>) => ({
        hostId: row.host_id as string,
        role: row.role as string,
        startedAt: toIso(row.started_at),
        lastSeenAt: toIso(row.last_seen_at),
        odpRuntime: (row.odp_runtime as RuntimeObservabilitySnapshot["hosts"][0]["odpRuntime"]) ?? [],
        metrics: (row.metrics as Record<string, unknown> | null) ?? undefined,
      })),
      executors: executorsRes.map((row: Record<string, unknown>) => ({
        executorId: row.executor_id as string,
        hostId: row.host_id as string,
        kind: row.kind as RuntimeObservabilitySnapshot["executors"][0]["kind"],
        parentId: (row.parent_id as string | null) ?? null,
        lastSeenAt: toIso(row.last_seen_at),
        status: row.status as RuntimeObservabilitySnapshot["executors"][0]["status"],
        metrics: (row.metrics as Record<string, unknown> | null) ?? undefined,
      })),
      workloads: workloadsRes.map((row: Record<string, unknown>) => ({
        workloadId: row.workload_id as string,
        hostId: row.host_id as string,
        pipelineKey: row.pipeline_key as RuntimeObservabilitySnapshot["workloads"][0]["pipelineKey"],
        runtime: row.runtime as RuntimeObservabilitySnapshot["workloads"][0]["runtime"],
        status: row.status as RuntimeObservabilitySnapshot["workloads"][0]["status"],
        lastTickAt: row.last_tick_at ? toIso(row.last_tick_at) : null,
        metrics: (row.metrics as Record<string, unknown> | null) ?? undefined,
      })),
      triggerCounters: triggersRes.map((row: Record<string, unknown>) => ({
        pipelineKey: row.pipeline_key as RuntimeObservabilitySnapshot["triggerCounters"][0]["pipelineKey"],
        eventType: row.event_type as string,
        source: row.source as string,
        count: Number(row.count),
      })),
      materializeCounters: materializeRes.map((row: Record<string, unknown>) => ({
        pipelineKey: row.pipeline_key as RuntimeObservabilitySnapshot["materializeCounters"][0]["pipelineKey"],
        count: Number(row.count),
        updatedAt: toIso(row.updated_at),
      })),
      generatedAt: new Date().toISOString(),
    };

    return runtimeObservabilitySnapshotSchema.parse(snapshot);
  }
}
