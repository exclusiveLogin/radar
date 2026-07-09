import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEPLOYMENT_MANIFEST } from "@radar/shared";
import { hostMatchesPipeline, resolveRuntimePipelines } from "./RuntimeResolver.js";

test("hostMatchesPipeline: role split vs monolith", () => {
  assert.equal(hostMatchesPipeline("tracking", "tracking"), true);
  assert.equal(hostMatchesPipeline("tracking", "phase"), false);
  assert.equal(hostMatchesPipeline("tracking", "all"), true);
  assert.equal(hostMatchesPipeline("all", "phase"), true);
});

test("resolveRuntimePipelines filters by workerRole", () => {
  const phase = resolveRuntimePipelines({
    manifest: DEFAULT_DEPLOYMENT_MANIFEST,
    workerRole: "phase",
  });
  assert.deepEqual(
    phase.map((p) => p.entry.pipelineKey).sort(),
    ["geo-enrich", "parse"],
  );

  const tracking = resolveRuntimePipelines({
    manifest: DEFAULT_DEPLOYMENT_MANIFEST,
    workerRole: "tracking",
  });
  assert.deepEqual(tracking.map((p) => p.entry.pipelineKey), ["tracking"]);
});
