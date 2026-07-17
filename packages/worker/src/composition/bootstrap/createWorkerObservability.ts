/**
 * ---
 * layer: worker/composition
 * domain: observability
 * purpose: Инициализирует recorder и host snapshot до запуска workloads.
 * ---
 */
import type { HostSnapshot, IObservabilityRecorder } from "@radar/shared";
import { createObservabilityRecorder } from "@radar/observability";
import { buildObsHostId, resolveObsConfig } from "../../infrastructure/config/obsMode.js";
import type { resolveWorkerBootstrapContext } from "./resolveWorkerBootstrapContext.js";
import type { createWorkerPersistence } from "./createWorkerPersistence.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;
type WorkerPersistence = Awaited<ReturnType<typeof createWorkerPersistence>>;

/** Регистрирует host только когда выбран реальный observability backend. */
export async function createWorkerObservability(
  context: Pick<
    BootstrapContext,
    "storageMode" | "workerRole" | "hostStartedAt" | "deploymentManifest" | "odp"
  >,
  persistence: Pick<WorkerPersistence, "dataSource">,
): Promise<{
  observabilityRecorder: IObservabilityRecorder | undefined;
  obsHostSnapshot: HostSnapshot | undefined;
}> {
  const obsConfig = resolveObsConfig(
    context.deploymentManifest.infra.obs,
    context.storageMode,
  );
  const observabilityRecorder =
    obsConfig.mode === "noop"
      ? undefined
      : createObservabilityRecorder({
          mode: obsConfig.mode,
          serviceUrl: obsConfig.serviceUrl,
          dataSource: obsConfig.mode === "embedded" ? persistence.dataSource : undefined,
        });

  if (!observabilityRecorder) {
    return { observabilityRecorder, obsHostSnapshot: undefined };
  }

  for (const entry of context.odp) {
    console.log(`[odp] ${entry.pipelineKey} → ${entry.runtime} (${entry.label})`);
  }

  const obsHostSnapshot: HostSnapshot = {
    hostId: buildObsHostId(context.workerRole),
    role: context.workerRole,
    startedAt: context.hostStartedAt,
    lastSeenAt: new Date().toISOString(),
    odpRuntime: context.odp.map((entry) => ({
      pipelineKey: entry.pipelineKey,
      label: entry.label,
      runtime: entry.runtime,
    })),
  };
  await observabilityRecorder.upsertHost(obsHostSnapshot);

  return { observabilityRecorder, obsHostSnapshot };
}
