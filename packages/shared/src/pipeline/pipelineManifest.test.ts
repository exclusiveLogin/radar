import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvOverlay } from "../manifest/applyEnvOverlay.js";
import {
  DEFAULT_PIPELINE_MANIFEST,
  pipelineManifestSchema,
} from "./pipelineManifest.schema.js";

const ARRAY_KEYS = {
  steps: "id",
  phases: "id",
};

test("DEFAULT_PIPELINE_MANIFEST parses empty steps/phases", () => {
  const parsed = pipelineManifestSchema.parse(DEFAULT_PIPELINE_MANIFEST);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.steps, []);
  assert.deepEqual(parsed.phases, []);
});

test("PIPELINE__ env overlay patches steps by id and phases by id", () => {
  const base = pipelineManifestSchema.parse({
    version: 1,
    steps: [
      {
        id: "ingest-live",
        kind: "source",
        pipelineKey: "ingest-live",
        enabled: true,
      },
      {
        id: "parse-queue",
        kind: "queue",
        pipelineKey: "parse",
        enabled: true,
      },
    ],
    phases: [
      {
        id: "catalog",
        triggerMode: "event",
        scope: "ingestParse",
        enrichers: ["catalog"],
        enabled: true,
        order: 0,
      },
      {
        id: "llm",
        triggerMode: "both",
        scope: "ingestParse",
        enrichers: ["llm"],
        enabled: true,
        order: 1,
      },
    ],
  });

  const merged = applyEnvOverlay(base, "PIPELINE", {
    "PIPELINE__steps__ingest-live__enabled": "false",
    "PIPELINE__steps__parse-queue__kind": "source",
    "PIPELINE__phases__catalog__enabled": "false",
    "PIPELINE__phases__llm__order": "5",
  }, ARRAY_KEYS);

  const manifest = pipelineManifestSchema.parse(merged);
  const live = manifest.steps.find((s) => s.id === "ingest-live");
  const parse = manifest.steps.find((s) => s.id === "parse-queue");
  const catalog = manifest.phases.find((p) => p.id === "catalog");
  const llm = manifest.phases.find((p) => p.id === "llm");

  assert.equal(live?.enabled, false);
  assert.equal(parse?.kind, "source");
  assert.equal(catalog?.enabled, false);
  assert.equal(llm?.order, 5);
});
