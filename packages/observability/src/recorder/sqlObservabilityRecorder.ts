import type {
  ExecutorSnapshot,
  HostSnapshot,
  IObservabilityRecorder,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  incrementTrigger,
  recordMaterialize,
  upsertExecutor,
  upsertHost,
  upsertWorkload,
} from "../store/sqlObservabilityStore.js";

/** Embedded SQL write-path через TypeORM DataSource. */
export class SqlObservabilityRecorder implements IObservabilityRecorder {
  constructor(private readonly dataSource: DataSource) {}

  private runner() {
    return {
      query: (sql: string, params?: unknown[]) => this.dataSource.query(sql, params),
    };
  }

  async upsertHost(host: HostSnapshot): Promise<void> {
    await upsertHost(this.runner(), host);
  }

  async upsertExecutor(executor: ExecutorSnapshot): Promise<void> {
    await upsertExecutor(this.runner(), executor);
  }

  async upsertWorkload(workload: WorkloadSnapshot): Promise<void> {
    await upsertWorkload(this.runner(), workload);
  }

  async incrementTrigger(key: TriggerCounterKey, delta = 1): Promise<void> {
    await incrementTrigger(this.runner(), key, delta);
  }

  async recordMaterialize(pipelineKey: string, delta = 1): Promise<void> {
    await recordMaterialize(this.runner(), pipelineKey, delta);
  }
}
