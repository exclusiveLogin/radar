import assert from "node:assert/strict";
import test from "node:test";
import type { DomainEvent, StepDescriptor } from "@radar/shared";
import {
  resolveStepLane,
  shouldAcceptStepTrigger,
} from "./stepTriggerRouter.js";

function baseStep(patch: Partial<StepDescriptor> = {}): StepDescriptor {
  return {
    id: "parse",
    kind: "queue",
    pipelineKey: "parse",
    trigger: { on: ["radar.raw.ingested"], accepts: {}, debounceMs: 250 },
    emits: [],
    enabled: true,
    ...patch,
  };
}

function event(patch: Partial<DomainEvent> & { type: DomainEvent["type"] }): DomainEvent {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    occurredAt: new Date().toISOString(),
    aggregateType: "step",
    aggregateId: null,
    payload: {},
    ...patch,
  };
}

test("resolveStepLane prefers meta.lane over payload.ingestMode", () => {
  assert.equal(
    resolveStepLane(
      event({
        type: "RawMessageIngested",
        meta: { lane: "backfill" },
        payload: { ingestMode: "live" },
      }),
    ),
    "backfill",
  );
  assert.equal(
    resolveStepLane(event({ type: "RawMessageIngested", payload: { ingestMode: "manual" } })),
    "manual",
  );
  assert.equal(resolveStepLane(event({ type: "RawMessageIngested" })), "live");
});

test("lane gate drops when lane not in accepts.lane", () => {
  const step = baseStep({
    id: "ingest-live",
    trigger: {
      on: ["radar.system.init"],
      accepts: { lane: ["live"] },
      debounceMs: 0,
    },
  });
  assert.equal(
    shouldAcceptStepTrigger(
      step,
      event({ type: "SystemInit", meta: { lane: "manual" } }),
      "radar.system.init",
    ),
    false,
  );
  assert.equal(
    shouldAcceptStepTrigger(
      step,
      event({ type: "SystemInit", meta: { lane: "live" } }),
      "radar.system.init",
    ),
    true,
  );
});

test("isolate routes only to matching stepId", () => {
  const parse = baseStep({ id: "parse" });
  const tracking = baseStep({ id: "tracking", pipelineKey: "tracking" });
  const isolated = event({
    type: "MessageParsed",
    meta: { isolate: true, stepId: "parse" },
    payload: { stepId: "parse" },
  });
  assert.equal(shouldAcceptStepTrigger(parse, isolated, "radar.message.parsed"), true);
  assert.equal(shouldAcceptStepTrigger(tracking, isolated, "radar.message.parsed"), false);
});

test("StepRunRequested routes only to payload.stepId", () => {
  const parse = baseStep({ id: "parse" });
  const geo = baseStep({ id: "geo-enrich", pipelineKey: "geo-enrich" });
  const req = event({
    type: "StepRunRequested",
    payload: { stepId: "parse" },
  });
  assert.equal(shouldAcceptStepTrigger(parse, req, "radar.step.run.requested"), true);
  assert.equal(shouldAcceptStepTrigger(geo, req, "radar.step.run.requested"), false);
});

test("ingress accepts by topic subscription only — no payload.pipelineKey hardcode", () => {
  const tracking = baseStep({
    id: "tracking",
    pipelineKey: "tracking",
    trigger: {
      on: ["radar.parse.stabilized"],
      accepts: {},
      debounceMs: 250,
    },
  });
  // Router не фильтрует payload: разводка — разные routing keys в DSL.
  assert.equal(
    shouldAcceptStepTrigger(
      tracking,
      event({ type: "PipelineStabilized", payload: { pipelineKey: "parse" } }),
      "radar.parse.stabilized",
    ),
    true,
  );
});
