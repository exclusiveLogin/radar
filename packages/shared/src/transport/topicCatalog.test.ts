import assert from "node:assert/strict";
import test from "node:test";
import type { PipelineManifest } from "../pipeline/pipelineManifest.schema.js";
import {
  buildTopicCatalog,
  listSystemTopicRoutingKeys,
  RADAR_TOPICS,
} from "./topicCatalog.js";

const SAMPLE: PipelineManifest = {
  version: 1,
  phases: [],
  steps: [
    {
      id: "parse",
      kind: "queue",
      pipelineKey: "parse",
      trigger: {
        on: [RADAR_TOPICS.RAW_INGESTED, "radar.demo.custom"],
        accepts: {},
        debounceMs: 250,
      },
      emits: [RADAR_TOPICS.MESSAGE_PARSED],
      enabled: true,
    },
  ],
};

test("listSystemTopicRoutingKeys returns RADAR_TOPICS values", () => {
  const keys = listSystemTopicRoutingKeys();
  assert.ok(keys.includes(RADAR_TOPICS.RAW_INGESTED));
  assert.ok(keys.includes(RADAR_TOPICS.STEP_RUN_REQUESTED));
  assert.ok(keys.includes(RADAR_TOPICS.SYSTEM_INIT));
});

test("buildTopicCatalog unions system keys with step trigger.on + emits, sorted", () => {
  const catalog = buildTopicCatalog(SAMPLE);
  assert.ok(catalog.includes(RADAR_TOPICS.RAW_INGESTED));
  assert.ok(catalog.includes(RADAR_TOPICS.MESSAGE_PARSED));
  assert.ok(catalog.includes("radar.demo.custom"));
  assert.ok(catalog.includes(RADAR_TOPICS.STEP_STARTED));

  const sorted = [...catalog].sort();
  assert.deepEqual(catalog, sorted);

  // без дублей
  assert.equal(catalog.length, new Set(catalog).size);
});
