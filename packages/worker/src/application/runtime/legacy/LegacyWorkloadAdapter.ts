import type {
  IObservabilityRecorder,
  ObsPipelineRuntime,
  ObsWorkloadStatus,
  PipelineKey,
} from "@radar/shared";
import { IngestParseDaemonService } from "./ingestParseDaemonService.js";
import { PlaceEnrichmentDaemonService } from "./placeEnrichmentDaemonService.js";
import { TrackingRebuildDaemon } from "./trackingRebuildDaemon.js";
import { buildWorkloadId, obsNow } from "../observability/obsContext.js";
import { reportTrigger } from "../observability/workloadObsHooks.js";
import type { ObsTickReporter } from "./obsTickReporter.js";

export type { ObsTickReporter } from "./obsTickReporter.js";

import type { PipelineLauncher } from "../pipelineLauncher.js";

export type { PipelineLauncher } from "../pipelineLauncher.js";

export type LegacyDaemonShell = {
  start(): void;
  stop(): void | Promise<void>;
};

export type LegacyWorkloadAdapterOptions = {
  pipelineKey: PipelineKey;
  hostId: string;
  recorder: IObservabilityRecorder;
  daemon: LegacyDaemonShell;
  workloadIdSuffix?: string;
};

/**
 * Обёртка legacy *DaemonService: start/stop/tick → recorder.upsertWorkload.
 * Не подключает busTrigger — legacy живёт на scheduler/timers.
 */
export class LegacyWorkloadAdapter implements PipelineLauncher {
  readonly runtime = "legacy" as const;
  readonly workloadId: string;

  constructor(private readonly options: LegacyWorkloadAdapterOptions) {
    this.workloadId = buildWorkloadId(
      options.hostId,
      options.pipelineKey,
      options.workloadIdSuffix,
    );
  }

  get pipelineKey(): PipelineKey {
    return this.options.pipelineKey;
  }

  /** Вызывается из ObsTickReporter внутри daemon tick. */
  reportTick(metrics?: Record<string, unknown>): void {
    const { recorder, hostId, pipelineKey } = this.options;
    reportTrigger({ recorder, pipelineKey, eventType: "tick" }, "scheduler");
    void recorder
      .upsertWorkload({
        workloadId: this.workloadId,
        hostId,
        pipelineKey,
        runtime: "legacy",
        status: "running",
        lastTickAt: obsNow(),
        metrics,
      })
      .catch((err: unknown) => {
        console.warn("[obs] legacy workload tick failed:", err);
      });
  }

  start(): void {
    this.options.daemon.start();
    void this.upsertStatus("running");
  }

  async stop(): Promise<void> {
    await this.options.daemon.stop();
    await this.upsertStatus("stopped");
  }

  private upsertStatus(status: ObsWorkloadStatus): Promise<void> {
    const { recorder, hostId, pipelineKey } = this.options;
    return recorder.upsertWorkload({
      workloadId: this.workloadId,
      hostId,
      pipelineKey,
      runtime: "legacy",
      status,
      lastTickAt: obsNow(),
    });
  }
}

function bindLegacyAdapter<T extends LegacyDaemonShell>(
  factory: (onTick: ObsTickReporter) => T,
  options: Omit<LegacyWorkloadAdapterOptions, "daemon">,
): LegacyWorkloadAdapter {
  const adapterRef: { current?: LegacyWorkloadAdapter } = {};
  const daemon = factory((metrics) => void adapterRef.current?.reportTick(metrics));
  const adapter = new LegacyWorkloadAdapter({ ...options, daemon });
  adapterRef.current = adapter;
  return adapter;
}

export function createLegacyIngestParseLauncher(
  deps: {
    phases: ConstructorParameters<typeof IngestParseDaemonService>[0];
    phaseRuns: ConstructorParameters<typeof IngestParseDaemonService>[1];
    coverage: ConstructorParameters<typeof IngestParseDaemonService>[2];
    runner: ConstructorParameters<typeof IngestParseDaemonService>[3];
  },
  obs: { recorder: IObservabilityRecorder; hostId: string },
): LegacyWorkloadAdapter {
  return bindLegacyAdapter(
    (onTick) =>
      new IngestParseDaemonService(
        deps.phases,
        deps.phaseRuns,
        deps.coverage,
        deps.runner,
        onTick,
      ),
    { pipelineKey: "parse", hostId: obs.hostId, recorder: obs.recorder },
  );
}

export function createLegacyGeoEnrichLauncher(
  deps: {
    phases: ConstructorParameters<typeof PlaceEnrichmentDaemonService>[0];
    phaseRuns: ConstructorParameters<typeof PlaceEnrichmentDaemonService>[1];
    placeJobs: ConstructorParameters<typeof PlaceEnrichmentDaemonService>[2];
    runner: ConstructorParameters<typeof PlaceEnrichmentDaemonService>[3];
  },
  obs: { recorder: IObservabilityRecorder; hostId: string },
): LegacyWorkloadAdapter {
  return bindLegacyAdapter(
    (onTick) =>
      new PlaceEnrichmentDaemonService(
        deps.phases,
        deps.phaseRuns,
        deps.placeJobs,
        deps.runner,
        onTick,
      ),
    { pipelineKey: "geo-enrich", hostId: obs.hostId, recorder: obs.recorder },
  );
}

export function createLegacyTrackingLauncher(
  dataSource: ConstructorParameters<typeof TrackingRebuildDaemon>[0],
  obs: { recorder: IObservabilityRecorder; hostId: string },
): LegacyWorkloadAdapter {
  return bindLegacyAdapter(
    (onTick) => new TrackingRebuildDaemon(dataSource, onTick),
    { pipelineKey: "tracking", hostId: obs.hostId, recorder: obs.recorder },
  );
}
