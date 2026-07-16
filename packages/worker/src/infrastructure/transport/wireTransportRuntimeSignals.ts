import type { IEventTransport, PhaseDefinitionRecord } from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import type { CoverageEnqueuer } from "../../application/phases/coverageEnqueuer.js";
import {
  roleRunsGeoDaemons,
  roleRunsParseDaemons,
  roleRunsTrackingDaemon,
  type WorkerRole,
} from "../config/workerRole.js";
import type { WorkerDbRepositories } from "../persistence/workerDbRepos.types.js";

export type WireTransportRuntimeSignalsInput = {
  transport: IEventTransport;
  workerRepos: WorkerDbRepositories;
  coverageEnqueuer: CoverageEnqueuer;
  workerRole: WorkerRole;
  /** Один drainOnce-тик через launcher (не runDrain until empty). */
  onParseWake?: () => void;
  onGeoWake?: () => void;
  onTrackingWake?: () => void;
};

/** Подписка worker на RMQ drain/control сигналы от admin/CLI/timer (топик своей роли). */
export function wireTransportRuntimeSignals(input: WireTransportRuntimeSignalsInput): void {
  const {
    transport,
    workerRepos,
    coverageEnqueuer,
    workerRole,
    onParseWake,
    onGeoWake,
    onTrackingWake,
  } = input;

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
    onWake?: () => void,
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
          } else if (payload.catchUp === true) {
            await coverageEnqueuer.catchUpPhase(phase.id);
          }
        }

        onWake?.();
      },
      { queueSuffix },
    );
  };

  if (roleRunsParseDaemons(workerRole)) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_PARSE, "ingestParse", "parse", onParseWake);
  }
  if (roleRunsGeoDaemons(workerRole)) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_GEO, "geoParse", "geo", onGeoWake);
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
        onGeoWake?.();
      },
      { queueSuffix: "geo" },
    );
  }
  if (roleRunsTrackingDaemon(workerRole)) {
    transport.subscribeSignal(
      RADAR_TOPICS.RUNNER_DRAIN_TRACKING,
      async () => {
        onTrackingWake?.();
      },
      { queueSuffix: PIPELINE_SUFFIX_TRACKING },
    );
  }
}

const PIPELINE_SUFFIX_TRACKING = "tracking";