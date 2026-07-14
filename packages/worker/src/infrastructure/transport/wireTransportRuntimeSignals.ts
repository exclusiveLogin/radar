import type { IEventTransport, PhaseDefinitionRecord } from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import type { PhaseRunner } from "../../application/phases/phaseRunner.js";
import type { WorkerDbRepositories } from "../persistence/workerDbRepos.types.js";

/** Подписка worker на RMQ drain/control сигналы от admin/CLI. */
export function wireTransportRuntimeSignals(input: {
  transport: IEventTransport;
  workerRepos: WorkerDbRepositories;
  phaseRunner: PhaseRunner;
}): void {
  const { transport, workerRepos, phaseRunner } = input;

  transport.subscribeSignal(RADAR_TOPICS.RUNNER_CONTROL, async (payload) => {
    const phaseKey = String(payload.phaseKey ?? "");
    if (!phaseKey) return;
    const enabled = payload.enabled;
    if (typeof enabled === "boolean") {
      await workerRepos.phaseDefinitions.setEnabled(phaseKey, enabled);
    }
  });

  const bindDrain = (topic: (typeof RADAR_TOPICS)[keyof typeof RADAR_TOPICS], scope: PhaseDefinitionRecord["scope"]) => {
    transport.subscribeSignal(topic, async (payload) => {
      const phaseKey = String(payload.phaseKey ?? "");
      if (!phaseKey) return;
      const phase = await workerRepos.phaseDefinitions.findById(phaseKey);
      if (!phase || phase.scope !== scope) return;
      const run = await workerRepos.phaseRuns.create({ phaseId: phase.id, trigger: "manual" });
      const ids = Array.isArray(payload.materializationIds)
        ? payload.materializationIds.map(String)
        : undefined;
      await phaseRunner.runDrain({
        phase,
        runId: run.id,
        trigger: "manual",
        batchSize: phase.policy.batchSize,
        materializationIds: ids,
        placeIds: Array.isArray(payload.placeIds)
          ? payload.placeIds.map(String)
          : undefined,
      });
    });
  };

  bindDrain(RADAR_TOPICS.RUNNER_DRAIN_PARSE, "ingestParse");
  bindDrain(RADAR_TOPICS.RUNNER_DRAIN_GEO, "geoParse");

  transport.subscribeSignal(RADAR_TOPICS.GEO_ENRICH_REQUEST, async (payload) => {
    const phaseKey = String(payload.phaseKey ?? "");
    if (!phaseKey) return;
    const phase = await workerRepos.phaseDefinitions.findById(phaseKey);
    if (!phase || phase.scope !== "geoParse") return;
    const run = await workerRepos.phaseRuns.create({ phaseId: phase.id, trigger: "manual" });
    const placeIds = Array.isArray(payload.placeIds) ? payload.placeIds.map(String) : undefined;
    const materializationIds = Array.isArray(payload.materializationIds)
      ? payload.materializationIds.map(String)
      : undefined;
    await phaseRunner.runDrain({
      phase,
      runId: run.id,
      trigger: "manual",
      batchSize: phase.policy.batchSize,
      placeIds,
      materializationIds,
    });
  });
}
