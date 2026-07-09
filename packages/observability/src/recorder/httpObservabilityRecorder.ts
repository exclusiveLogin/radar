import type {
  ExecutorSnapshot,
  HostSnapshot,
  IObservabilityRecorder,
  ObsIngestBatch,
  TriggerCounterKey,
  WorkloadSnapshot,
} from "@radar/shared";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:3020";

/** HTTP write-path: push partial batch в obs-service. */
export class HttpObservabilityRecorder implements IObservabilityRecorder {
  constructor(private readonly serviceUrl: string = DEFAULT_SERVICE_URL) {}

  /** POST batch на obs-service ingest endpoint. */
  private async postBatch(batch: ObsIngestBatch): Promise<void> {
    const base = this.serviceUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/obs/v1/ingest/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`obs ingest failed: ${res.status} ${body}`);
    }
  }

  async upsertHost(host: HostSnapshot): Promise<void> {
    await this.postBatch({ host, executors: [], workloads: [], triggers: [], materialize: [] });
  }

  async upsertExecutor(executor: ExecutorSnapshot): Promise<void> {
    await this.postBatch({ executors: [executor], workloads: [], triggers: [], materialize: [] });
  }

  async upsertWorkload(workload: WorkloadSnapshot): Promise<void> {
    await this.postBatch({ executors: [], workloads: [workload], triggers: [], materialize: [] });
  }

  async incrementTrigger(key: TriggerCounterKey, delta = 1): Promise<void> {
    await this.postBatch({
      executors: [],
      workloads: [],
      triggers: [{ key, delta }],
      materialize: [],
    });
  }

  async recordMaterialize(pipelineKey: string, delta = 1): Promise<void> {
    await this.postBatch({
      executors: [],
      workloads: [],
      triggers: [],
      materialize: [
        { pipelineKey: pipelineKey as WorkloadSnapshot["pipelineKey"], delta },
      ],
    });
  }
}
