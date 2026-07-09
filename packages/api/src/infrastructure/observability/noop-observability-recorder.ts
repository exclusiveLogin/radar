import type {
  ExecutorSnapshot,
  HostSnapshot,
  IObservabilityRecorder,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "@radar/shared";

/** No-op recorder: memory mode или RADAR_OBS_MODE=noop. */
export class NoopObservabilityRecorder implements IObservabilityRecorder {
  async upsertHost(_host: HostSnapshot): Promise<void> {}

  async upsertExecutor(_executor: ExecutorSnapshot): Promise<void> {}

  async upsertWorkload(_workload: WorkloadSnapshot): Promise<void> {}

  async incrementTrigger(_key: TriggerCounterKey, _delta?: number): Promise<void> {}

  async recordMaterialize(_pipelineKey: string, _delta?: number): Promise<void> {}
}
