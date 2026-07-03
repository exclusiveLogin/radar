import assert from "node:assert/strict";
import test from "node:test";
import type { SignalEnvelope } from "../../runtime/runner-platform/runnerContracts.js";
import { createTrackingTelemetryBridge, TRACKING_PIPELINE_KEY } from "./trackingTelemetryBridge.js";
import type { TrackingRunnerArtifact } from "./trackingRunnerContracts.js";

function fakeEnvelope(stats: TrackingRunnerArtifact["stats"]): SignalEnvelope<TrackingRunnerArtifact> {
  return {
    pipelineKey: TRACKING_PIPELINE_KEY,
    runId: "run-1",
    at: new Date().toISOString(),
    policy: { durable: true, persist: false, ephemeral: false },
    payload: { runId: "run-1", result: null, stats },
  };
}

test("emitProgress namespaces phaseKey by stats.stage", () => {
  const bridge = createTrackingTelemetryBridge();
  const received: (string | undefined)[] = [];
  bridge.bus.subscribe((envelope) => received.push(envelope.phaseKey));

  bridge.emitProgress(fakeEnvelope({ stage: "cluster" }));
  bridge.emitProgress(fakeEnvelope({ stage: "done" }));

  assert.deepEqual(received, ["tracking.cluster", "tracking.done"]);
});

test("emitProgress leaves phaseKey undefined when stage is missing", () => {
  const bridge = createTrackingTelemetryBridge();
  const received: (string | undefined)[] = [];
  bridge.bus.subscribe((envelope) => received.push(envelope.phaseKey));

  bridge.emitProgress(fakeEnvelope({}));

  assert.deepEqual(received, [undefined]);
});

test("emitProgress preserves the rest of the envelope untouched", () => {
  const bridge = createTrackingTelemetryBridge();
  let observed: SignalEnvelope<TrackingRunnerArtifact> | undefined;
  bridge.bus.subscribe((envelope) => {
    observed = envelope;
  });

  const envelope = fakeEnvelope({ stage: "join" });
  bridge.emitProgress(envelope);

  assert.equal(observed?.pipelineKey, TRACKING_PIPELINE_KEY);
  assert.equal(observed?.runId, "run-1");
  assert.deepEqual(observed?.policy, { durable: true, persist: false, ephemeral: false });
  assert.deepEqual(observed?.payload, envelope.payload);
});
