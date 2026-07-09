import type {
  ExecutorSnapshot,
  HostSnapshot,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "../schemas/observability/runtime-snapshot";

/**
 * Write-side порт observability BC: producers пушат снимки, не знают про admin UI.
 * Реализации: embedded SQL (Iter 1), HTTP sidecar (Iter 3).
 */
export interface IObservabilityRecorder {
  upsertHost(host: HostSnapshot): Promise<void>;
  upsertExecutor(executor: ExecutorSnapshot): Promise<void>;
  upsertWorkload(workload: WorkloadSnapshot): Promise<void>;
  incrementTrigger(key: TriggerCounterKey, delta?: number): Promise<void>;
  recordMaterialize(pipelineKey: string, delta?: number): Promise<void>;
}
