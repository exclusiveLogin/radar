import type { IEventTransport, PhaseDefinitionRecord } from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import { hasCap, type DomainCap } from "../config/workerRole.js";

const PIPELINE_SUFFIX_TRACKING = "tracking";

export type ParseDrainPrepInput = {
  phase: PhaseDefinitionRecord;
  mode: "targeted" | "full";
  ids?: string[];
  catchUp?: boolean;
};

export type GeoEnrichPrepInput = {
  phase: PhaseDefinitionRecord;
  placeIds?: string[];
};

/**
 * Composition injects ports/handlers — infra не знает CoverageEnqueuer / workerRepos bag.
 */
export type WireTransportRuntimeSignalsInput = {
  transport: IEventTransport;
  caps: ReadonlySet<DomainCap>;
  setPhaseEnabled?: (phaseKey: string, enabled: boolean) => Promise<void>;
  findPhase?: (phaseKey: string) => Promise<PhaseDefinitionRecord | null>;
  prepareParseDrain?: (input: ParseDrainPrepInput) => Promise<void>;
  prepareGeoEnrich?: (input: GeoEnrichPrepInput) => Promise<void>;
  /** Один drainOnce-тик через launcher (не runDrain until empty). */
  onParseWake?: () => void;
  onGeoWake?: () => void;
  onTrackingWake?: () => void;
};

/** Подписка worker на RMQ drain/control сигналы от admin/CLI/timer (топик своей роли). */
export function wireTransportRuntimeSignals(
  input: WireTransportRuntimeSignalsInput,
): () => void {
  const {
    transport,
    caps,
    setPhaseEnabled,
    findPhase,
    prepareParseDrain,
    prepareGeoEnrich,
    onParseWake,
    onGeoWake,
    onTrackingWake,
  } = input;

  const teardown: Array<() => void> = [];

  if (setPhaseEnabled) {
    teardown.push(
      transport.subscribeSignal(RADAR_TOPICS.RUNNER_CONTROL, async (payload) => {
        const phaseKey = String(payload.phaseKey ?? "");
        if (!phaseKey) return;
        const enabled = payload.enabled;
        if (typeof enabled === "boolean") {
          await setPhaseEnabled(phaseKey, enabled);
        }
      }),
    );
  }

  const bindDrain = (
    topic: (typeof RADAR_TOPICS)[keyof typeof RADAR_TOPICS],
    scope: PhaseDefinitionRecord["scope"],
    queueSuffix: string,
    onWake?: () => void,
  ) => {
    if (!findPhase) return;
    teardown.push(transport.subscribeSignal(
      topic,
      async (payload) => {
        const phaseKey = String(payload.phaseKey ?? "");
        if (!phaseKey) return;
        const phase = await findPhase(phaseKey);
        if (!phase || phase.scope !== scope) return;

        const mode = payload.mode === "targeted" ? "targeted" : "full";
        const ids = Array.isArray(payload.materializationIds)
          ? payload.materializationIds.map(String)
          : undefined;

        if (scope === "ingestParse" && prepareParseDrain) {
          await prepareParseDrain({
            phase,
            mode,
            ids,
            catchUp: payload.catchUp === true,
          });
        }

        onWake?.();
      },
      { queueSuffix },
    ));
  };

  if (hasCap(caps, "parse")) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_PARSE, "ingestParse", "parse", onParseWake);
  }
  if (hasCap(caps, "geo")) {
    bindDrain(RADAR_TOPICS.RUNNER_DRAIN_GEO, "geoParse", "geo", onGeoWake);
    if (findPhase) {
      teardown.push(transport.subscribeSignal(
        RADAR_TOPICS.GEO_ENRICH_REQUEST,
        async (payload) => {
          const phaseKey = String(payload.phaseKey ?? "");
          if (!phaseKey) return;
          const phase = await findPhase(phaseKey);
          if (!phase || phase.scope !== "geoParse") return;

          const placeIds = [
            ...(Array.isArray(payload.placeIds) ? payload.placeIds.map(String) : []),
            ...(Array.isArray(payload.materializationIds)
              ? payload.materializationIds.map(String)
              : []),
          ];
          if (placeIds.length && prepareGeoEnrich) {
            await prepareGeoEnrich({ phase, placeIds });
          }
          onGeoWake?.();
        },
        { queueSuffix: "geo" },
      ));
    }
  }
  if (hasCap(caps, "tracking")) {
    teardown.push(transport.subscribeSignal(
      RADAR_TOPICS.RUNNER_DRAIN_TRACKING,
      async () => {
        onTrackingWake?.();
      },
      { queueSuffix: PIPELINE_SUFFIX_TRACKING },
    ));
  }

  return () => teardown.forEach((unsubscribe) => unsubscribe());
}
