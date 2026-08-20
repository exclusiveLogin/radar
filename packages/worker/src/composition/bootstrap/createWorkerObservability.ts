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
import {
  PIPELINES_OWNED_BY_ROLE,
  type WorkerRole,
} from "../../infrastructure/config/workerRole.js";
import type { resolveWorkerBootstrapContext } from "./resolveWorkerBootstrapContext.js";
import type { createWorkerPersistence } from "./createWorkerPersistence.js";

type BootstrapContext = ReturnType<typeof resolveWorkerBootstrapContext>;
type WorkerPersistence = Awaited<ReturnType<typeof createWorkerPersistence>>;

/** ODP-записи только по пайплайнам этой роли (не весь каталог стека). */
function odpRuntimeForRole(
  role: WorkerRole,
  odp: BootstrapContext["odp"],
): HostSnapshot["odpRuntime"] {
  const owned = new Set(PIPELINES_OWNED_BY_ROLE[role]);
  return odp
    .filter((entry) => owned.has(entry.pipelineKey))
    .map((entry) => ({
      pipelineKey: entry.pipelineKey,
      label: entry.label,
      runtime: entry.runtime,
    }));
}

/** Регистрирует host только когда выбран реальный observability backend. */
export async function createWorkerObservability(
  context: Pick<
    BootstrapContext,
    "storageMode" | "workerRole" | "hostStartedAt" | "infraManifest" | "odp"
  >,
  persistence: Pick<WorkerPersistence, "dataSource">,
): Promise<{
  observabilityRecorder: IObservabilityRecorder | undefined;
  obsHostSnapshot: HostSnapshot | undefined;
}> {
  const obsConfig = resolveObsConfig(
    context.infraManifest.infra.obs,
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

  const odpRuntime = odpRuntimeForRole(context.workerRole, context.odp);
  for (const entry of odpRuntime) {
    console.log(`[odp] ${entry.pipelineKey} → ${entry.runtime} (${entry.label})`);
  }

  const obsHostSnapshot: HostSnapshot = {
    hostId: buildObsHostId(context.workerRole),
    role: context.workerRole,
    startedAt: context.hostStartedAt,
    lastSeenAt: new Date().toISOString(),
    odpRuntime,
    metrics: {
      caps: [context.workerRole],
      duty:
        odpRuntime.length > 0
          ? odpRuntime.map((e) => e.pipelineKey).join(",")
          : context.workerRole,
    },
  };
  await observabilityRecorder.upsertHost(obsHostSnapshot);

  return { observabilityRecorder, obsHostSnapshot };
}
