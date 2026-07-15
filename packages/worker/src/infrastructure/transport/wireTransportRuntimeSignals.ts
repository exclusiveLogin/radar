import type { IEventTransport, PhaseDefinitionRecord } from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import type { CoverageEnqueuer } from "../../application/phases/coverageEnqueuer.js";
import type { PhaseRunner } from "../../application/phases/phaseRunner.js";
import {
  roleRunsGeoDaemons,
  roleRunsParseDaemons,
  type WorkerRole,
} from "../config/workerRole.js";
import type { WorkerDbRepositories } from "../persistence/workerDbRepos.types.js";

/** Подписка worker на RMQ drain/control сигналы от admin/CLI (топик только своей роли). */
export function wireTransportRuntimeSignals(input: {
  transport: IEventTransport;
  workerRepos: WorkerDbRepositories;
  phaseRunner: PhaseRunner;
  coverageEnqueuer: CoverageEnqueuer;
  workerRole: WorkerRole;
}): void {
  const { transport, workerRepos, phaseRunner, coverageEnqueuer, workerRole } = input;

  transport.subscribeSignal(RADAR_TOPICS.RUNNER_CONTROL, async (payload) => {
    const phaseKey = String(payload.phaseKey ?? "");
    if (!phaseKey) return;
    const enabled = payload.enabled;
    if (typeof enabled === "boolean") {
      await workerRepos.phaseDefinitions.setEnabled(phaseKey, enabled);
    }
  });

  const bindDrain = (
    topic: (typeof RADAR_TOPICS)[keyof typeof RADAR_TOPICS],
    scope: PhaseDefinitionRecord["scope"],
    queueSuffix: string,
  ) => {
    transport.subscribeSignal(
      topic,
      async (payload) => {
        const phaseKey = String(payload.phaseKey ?? "");
        if (!phaseKey) return;
        const phase = await workerRepos.phaseDefinitions.findById(phaseKey);
        if (!phase || phase.scope !== scope) return;

        const mode = payload.mode === "targeted" ? "targeted" : "full";
        const ids = Array.isArray(payload.materializationIds)
          ? payload.materializationIds.map(String)
          : undefined;

        if (scope === "ingestParse") {
          if (mode === "targeted" && ids?.length) {
            await coverageEnqueuer.planPendingForIds(ids);
          } else {
            await coverageEnqueuer.catchUpPhase(phase.id);
          }
        }

        const run = await workerRepos.phaseRuns.create({ phaseId: phase.id, trigger: "manual" });
        await phaseRunner.runDrain({
          phase,
          runId: run.id,
          trigger: "manual",
          batchSize: phase.policy.batchSize,
          materializationIds: mode === "targeted" ? ids : undefined,
          placeIds: Array.isArray(payload.placeIds)
            ? payload.placeIds.map(String)
            : undefined,
        });
      },
      { queueSuffix },
    );
  };

  if (roleRunsParseDaemons(workerRole)) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_PARSE, "ingestParse", "parse");
  }
  if (roleRunsGeoDaemons(workerRole)) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_GEO, "geoParse", "geo");
    transport.subscribeSignal(
      RADAR_TOPICS.GEO_ENRICH_REQUEST,
      async (payload) => {
        const phaseKey = String(payload.phaseKey ?? "");
        if (!phaseKey) return;
        const phase = await workerRepos.phaseDefinitions.findById(phaseKey);
        if (!phase || phase.scope !== "geoParse") return;

        const ids = Array.isArray(payload.materializationIds)
          ? payload.materializationIds.map(String)
          : undefined;
        if (ids?.length) {
          await coverageEnqueuer.planPendingForIds(ids);
        }

        const run = await workerRepos.phaseRuns.create({ phaseId: phase.id, trigger: "manual" });
        const placeIds = Array.isArray(payload.placeIds) ? payload.placeIds.map(String) : undefined;
        await phaseRunner.runDrain({
          phase,
          runId: run.id,
          trigger: "manual",
          batchSize: phase.policy.batchSize,
          placeIds,
          materializationIds: ids,
        });
      },
      { queueSuffix: "geo" },
    );
  }
}
