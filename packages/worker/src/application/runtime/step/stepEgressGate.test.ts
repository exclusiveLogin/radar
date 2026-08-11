import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainEvent,
  IEventTransport,
  PipelineManifest,
  StepDescriptor,
  StepRunContext,
  Unsubscribe,
} from "@radar/shared";
import { RADAR_TOPICS } from "@radar/shared";
import { publishStepEmits } from "./stepEgressGate.js";

function fakeTransport(): IEventTransport & { published: Array<{ key: string; events: DomainEvent[] }> } {
  const published: Array<{ key: string; events: DomainEvent[] }> = [];
  return {
    published,
    async publish(key, events) {
      published.push({ key, events: [...events] });
    },
    async publishSignal() {},
    subscribe(): Unsubscribe {
      return () => undefined;
    },
    subscribeSignal(): Unsubscribe {
      return () => undefined;
    },
    async start() {},
    async stop() {},
  };
}

const parseStep: StepDescriptor = {
  id: "parse",
  kind: "queue",
  pipelineKey: "parse",
  trigger: { on: ["radar.raw.ingested"], accepts: {}, debounceMs: 250 },
  emits: [RADAR_TOPICS.MESSAGE_PARSED, RADAR_TOPICS.PARSE_STABILIZED],
  enabled: true,
};

const trackingStep: StepDescriptor = {
  id: "tracking",
  kind: "queue",
  pipelineKey: "tracking",
  trigger: { on: [RADAR_TOPICS.MESSAGE_PARSED], accepts: {}, debounceMs: 250 },
  emits: [],
  enabled: true,
};

const manifest: PipelineManifest = {
  version: 1,
  steps: [parseStep, trackingStep],
  phases: [],
};

const ctx: StepRunContext = {
  stepId: "parse",
  runId: "run-1",
  lane: "live",
  isolate: false,
  correlationId: "corr-1",
  trigger: { topic: RADAR_TOPICS.RAW_INGESTED, source: "bus" },
};

test("egress whitelist rejects unknown emit key", async () => {
  const transport = fakeTransport();
  await assert.rejects(
    () =>
      publishStepEmits({
        step: parseStep,
        ctx,
        emits: [{ key: "radar.unknown.topic", payload: {} }],
        transport,
        manifest,
      }),
    /not in step "parse" emits whitelist/,
  );
  assert.equal(transport.published.length, 0);
});

test("egress publishes whitelisted key with stamped meta", async () => {
  const transport = fakeTransport();
  const result = await publishStepEmits({
    step: parseStep,
    ctx,
    emits: [{ key: RADAR_TOPICS.MESSAGE_PARSED, payload: { rawMessageId: "r1" } }],
    transport,
    manifest,
  });
  assert.deepEqual(result.published, [RADAR_TOPICS.MESSAGE_PARSED]);
  assert.equal(result.suppressed.length, 0);
  assert.equal(transport.published.length, 1);
  const event = transport.published[0]!.events[0]!;
  assert.equal(event.meta?.stepId, "parse");
  assert.equal(event.meta?.runId, "run-1");
  assert.equal(event.meta?.lane, "live");
  assert.equal(event.meta?.isolate, false);
  assert.equal(event.meta?.correlationId, "corr-1");
});

test("isolate suppresses domain emits and records downstream", async () => {
  const transport = fakeTransport();
  const isolated: StepRunContext = { ...ctx, isolate: true };
  const result = await publishStepEmits({
    step: parseStep,
    ctx: isolated,
    emits: [
      { key: RADAR_TOPICS.MESSAGE_PARSED, payload: { rawMessageId: "r1" } },
      { key: RADAR_TOPICS.PARSE_STABILIZED, payload: { pipelineKey: "parse" } },
    ],
    transport,
    manifest,
  });
  assert.deepEqual(result.published, []);
  assert.equal(result.suppressed.length, 2);
  assert.deepEqual(result.suppressed[0]!.downstreamStepIds, ["tracking"]);
  assert.equal(transport.published.length, 0);
});

test("isolate still allows lifecycle StepStarted key through whitelist bypass", async () => {
  const transport = fakeTransport();
  const isolated: StepRunContext = { ...ctx, isolate: true };
  const result = await publishStepEmits({
    step: parseStep,
    ctx: isolated,
    emits: [
      { key: RADAR_TOPICS.STEP_STARTED, payload: { stepId: "parse", runId: "run-1" } },
      { key: RADAR_TOPICS.MESSAGE_PARSED, payload: { rawMessageId: "r1" } },
    ],
    transport,
    manifest,
  });
  assert.deepEqual(result.published, [RADAR_TOPICS.STEP_STARTED]);
  assert.equal(result.suppressed.length, 1);
  assert.equal(transport.published[0]!.events[0]!.meta?.isolate, true);
});
