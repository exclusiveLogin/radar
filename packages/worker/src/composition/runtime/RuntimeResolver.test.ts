import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEPLOYMENT_MANIFEST } from "@radar/shared";
import { hostMatchesPipeline, resolveRuntimePipelines } from "./RuntimeResolver.js";

test("hostMatchesPipeline: exact role match only", () => {
  assert.equal(hostMatchesPipeline("tracking", "tracking"), true);
  assert.equal(hostMatchesPipeline("tracking", "parse"), false);
  assert.equal(hostMatchesPipeline("parse", "geo"), false);
});

test("resolveRuntimePipelines filters by workerRole", () => {
  const parse = resolveRuntimePipelines({
    manifest: DEFAULT_DEPLOYMENT_MANIFEST,
    workerRole: "parse",
  });
  assert.deepEqual(parse.map((p) => p.entry.pipelineKey), ["parse"]);

  const tracking = resolveRuntimePipelines({
    manifest: DEFAULT_DEPLOYMENT_MANIFEST,
    workerRole: "tracking",
  });
  assert.deepEqual(tracking.map((p) => p.entry.pipelineKey), ["tracking"]);
});