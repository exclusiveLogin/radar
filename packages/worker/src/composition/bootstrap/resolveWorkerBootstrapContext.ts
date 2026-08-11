/**
 * ---
 * layer: worker/composition
 * domain: bootstrap
 * purpose: Разрешает неизменяемый контекст запуска worker.
 * ---
 */
import { loadInfraManifest } from "@radar/shared/infra/infraManifest.loader.js";
import { loadWorkerRuntimeManifest } from "@radar/shared/manifest/domains/workerRuntime.loader.js";
import { MONOREPO_ROOT } from "@repo/root";
import { MetricsAggregator, ParseAttemptLogger, PrometheusDomainEventCounter } from "../../application/subscribers/index.js";
import type { WorkerCompositionOptions } from "../../application/workerCompositionRoot.types.js";
import { odpResolve } from "../odp/index.js";
import { resolveRuntimePipelines } from "../runtime/index.js";
import { PipelineLauncherRegistry } from "../runtime/PipelineLauncherRegistry.js";
import { WorkerLifecycle } from "../lifecycle/WorkerLifecycle.js";
import {
  capsFor,
  hasCap,
  resolveWorkerRoleFromEnv,
} from "../../infrastructure/config/workerRole.js";
import {
  resolveWorkerStorageModeFromEnv,
} from "../../infrastructure/persistence/storageMode.js";
import { InProcessEventBus } from "../../infrastructure/events/inProcessEventBus.js";
import { getWorkerPrometheusMetrics } from "../../infrastructure/metrics/workerPrometheusMetrics.js";

/** Создаёт общие значения, используемые всеми bootstrap slices. */
export function resolveWorkerBootstrapContext(options: WorkerCompositionOptions) {
  const storageMode = options.storageMode ?? resolveWorkerStorageModeFromEnv();
  const workerRole = options.workerRole ?? resolveWorkerRoleFromEnv();
  const caps = capsFor(workerRole, options.bootCaps);
  const needsParseStack = hasCap(caps, "parse") || hasCap(caps, "geo");
  const needsIngestPath = hasCap(caps, "ingest") || hasCap(caps, "backfill");
  const infraManifest = loadInfraManifest({ repoRoot: MONOREPO_ROOT });
  const workerRuntime = loadWorkerRuntimeManifest({ repoRoot: MONOREPO_ROOT });
  const bus = new InProcessEventBus();
  const metricsAggregator = new MetricsAggregator();
  const prometheusDomainEvents = new PrometheusDomainEventCounter(
    getWorkerPrometheusMetrics().registry,
  );

  bus.subscribe("*", metricsAggregator.handler);
  bus.subscribe("*", prometheusDomainEvents.handler);

  if (needsParseStack) {
    const parseAttemptLogger = new ParseAttemptLogger(workerRuntime.logging.verboseParse);
    bus.subscribe("MessageParsed", parseAttemptLogger.handler);
    bus.subscribe("MessageParseFailed", parseAttemptLogger.handler);
  }

  return {
    storageMode,
    workerRole,
    caps,
    needsParseStack,
    needsIngestPath,
    hostStartedAt: new Date().toISOString(),
    infraManifest,
    workerRuntime,
    odp: odpResolve(infraManifest),
    runtimePipelines: resolveRuntimePipelines({
      manifest: infraManifest,
      workerRole,
    }),
    bus,
    metricsAggregator,
    lifecycle: new WorkerLifecycle(),
    pipelineLaunchers: new PipelineLauncherRegistry(),
  };
}
