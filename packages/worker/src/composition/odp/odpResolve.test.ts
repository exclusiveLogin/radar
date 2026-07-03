import assert from "node:assert/strict";
import test from "node:test";
import { odpResolve } from "./odpResolve.js";
import type { OdpManifestEntry } from "./odpManifest.js";

test("odpResolve maps enabled/disabled flags to runner-platform/legacy runtime", () => {
  const manifest: OdpManifestEntry[] = [
    { pipelineKey: "tracking", label: "t", runnerPlatformEnabled: () => true },
    { pipelineKey: "parse", label: "p", runnerPlatformEnabled: () => false },
  ];

  const resolved = odpResolve(manifest);

  assert.deepEqual(resolved, [
    { pipelineKey: "tracking", label: "t", runtime: "runner-platform" },
    { pipelineKey: "parse", label: "p", runtime: "legacy" },
  ]);
});

test("odpResolve defaults to the real ODP_MANIFEST (tracking/parse/geo-enrich, all legacy by default)", () => {
  const resolved = odpResolve();
  const keys = resolved.map((r) => r.pipelineKey).sort();
  assert.deepEqual(keys, ["geo-enrich", "parse", "tracking"]);
  for (const entry of resolved) {
    assert.equal(entry.runtime, "legacy", `${entry.pipelineKey} must default to legacy runtime`);
  }
});
