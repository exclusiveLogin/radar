import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineManifest, StepDescriptor } from "./pipelineManifest.schema.js";
import {
  buildPipelineGraph,
  cascadeResetOrder,
  downstreamStepIds,
  stabilizedEmitKeyForPipeline,
} from "./pipelineGraph.js";

function step(patch: Partial<StepDescriptor> & Pick<StepDescriptor, "id">): StepDescriptor {
  return {
    kind: "queue",
    pipelineKey: patch.id,
    trigger: { on: [], accepts: {}, debounceMs: 250 },
    emits: [],
    enabled: true,
    ...patch,
  };
}

const SAMPLE: PipelineManifest = {
  version: 1,
  phases: [],
  steps: [
    step({
      id: "ingest",
      kind: "source",
      emits: ["radar.raw.ingested"],
      resets: { handler: "ingest", cascade: true },
    }),
    step({
      id: "parse",
      trigger: { on: ["radar.raw.ingested"], accepts: {}, debounceMs: 250 },
      emits: ["radar.message.parsed", "radar.parse.stabilized"],
      resets: { handler: "parse", cascade: true },
    }),
    step({
      id: "tracking",
      trigger: {
        on: ["radar.message.parsed", "radar.parse.stabilized"],
        accepts: {},
        debounceMs: 250,
      },
      emits: [],
      resets: { handler: "tracking", cascade: false },
    }),
    step({
      id: "geo-enrich",
      pipelineKey: "geo-enrich",
      emits: [],
      resets: { handler: "geo", cascade: true },
    }),
    step({
      id: "disabled-sink",
      enabled: false,
      trigger: { on: ["radar.message.parsed"], accepts: {}, debounceMs: 0 },
      emits: [],
    }),
  ],
};

test("buildPipelineGraph: edges by emits ∩ trigger.on; skips disabled", () => {
  const graph = buildPipelineGraph(SAMPLE);
  assert.deepEqual(
    graph.nodes.map((n) => n.id).sort(),
    ["geo-enrich", "ingest", "parse", "tracking"],
  );
  assert.deepEqual(
    graph.edges
      .map((e) => `${e.fromStepId}->${e.toStepId}:${e.key}`)
      .sort(),
    [
      "ingest->parse:radar.raw.ingested",
      "parse->tracking:radar.message.parsed",
      "parse->tracking:radar.parse.stabilized",
    ],
  );
  assert.equal(
    graph.edges.some((e) => e.fromStepId === "geo-enrich"),
    false,
    "geo has no domain emits → no edge to tracking",
  );
});

test("stabilizedEmitKeyForPipeline reads *.stabilized from step.emits", () => {
  assert.equal(stabilizedEmitKeyForPipeline(SAMPLE, "parse"), "radar.parse.stabilized");
  assert.equal(stabilizedEmitKeyForPipeline(SAMPLE, "geo-enrich"), null);
});

test("downstreamStepIds: unique targets from step", () => {
  assert.deepEqual(downstreamStepIds(SAMPLE, "ingest"), ["parse"]);
  assert.deepEqual(downstreamStepIds(SAMPLE, "parse").sort(), ["tracking"]);
  assert.deepEqual(downstreamStepIds(SAMPLE, "tracking"), []);
});

test("cascadeResetOrder: descendants first, only steps with resets.handler", () => {
  // parse → tracking; order = [tracking, parse] (DFS post-order)
  assert.deepEqual(cascadeResetOrder(SAMPLE, "parse"), ["tracking", "parse"]);
  assert.deepEqual(cascadeResetOrder(SAMPLE, "ingest"), ["tracking", "parse", "ingest"]);
  assert.deepEqual(cascadeResetOrder(SAMPLE, "tracking"), ["tracking"]);
});
