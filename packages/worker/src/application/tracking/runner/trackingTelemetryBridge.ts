/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Telemetry bridge для tracking workload — публикует typed SignalEnvelope в общую
 *          runner-platform шину (см. worker/runtime/runner-platform/telemetryBus.ts) параллельно
 *          с уже существующей персистенцией в trajectory_rebuild_runs.stats (не заменяет её —
 *          DB остаётся источником правды для poller/REST; шина — для будущих live-WS подписчиков).
 *          `phaseKey` (naming disambiguation): "tracking.<stage>" — stage из nextgen-конвейера
 *          (cluster/field_train/join/idle/done), не путать с parse/geo-enrich phaseKey того же вида.
 * ---
 */
import { createTelemetryBus, type TelemetryBus } from "../../runtime/runner-platform/telemetryBus.js";
import type { EmitProgress } from "../../runtime/runner-platform/runnerContracts.js";
import type { TrackingRunnerArtifact } from "./trackingRunnerContracts.js";

export const TRACKING_PIPELINE_KEY = "tracking";

export function createTrackingTelemetryBridge(): {
  bus: TelemetryBus<TrackingRunnerArtifact>;
  emitProgress: EmitProgress<TrackingRunnerArtifact>;
} {
  const bus = createTelemetryBus<TrackingRunnerArtifact>();
  return {
    bus,
    emitProgress: (envelope) => {
      const stage = envelope.payload.stats.stage;
      bus.publish({ ...envelope, phaseKey: stage ? `${TRACKING_PIPELINE_KEY}.${stage}` : undefined });
    },
  };
}
