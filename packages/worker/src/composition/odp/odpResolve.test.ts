import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DEPLOYMENT_MANIFEST } from "@radar/shared";
import { odpResolve } from "./odpResolve.js";

test("odpResolve maps schedulingImpl to runner-platform/legacy runtime", () => {
  const manifest = {
    ...DEFAULT_DEPLOYMENT_MANIFEST,
    runners: {
      pipelines: [
        {
          pipelineKey: "tracking" as const,
          label: "t",
          host: "tracking" as const,
          spawn: "in-process" as const,
          schedulingImpl: "runner-platform" as const,
          enabled: true,
        },
        {
          pipelineKey: "parse" as const,
          label: "p",
          host: "phase" as const,
          spawn: "in-process" as const,
          schedulingImpl: "legacy" as const,
          enabled: true,
        },
      ],
    },
  };

  const resolved = odpResolve(manifest);

  assert.deepEqual(resolved, [
    {
      pipelineKey: "tracking",
      label: "t",
      runtime: "runner-platform",
      host: "tracking",
      spawn: "in-process",
      schedulingImpl: "runner-platform",
    },
    {
      pipelineKey: "parse",
      label: "p",
      runtime: "legacy",
      host: "phase",
      spawn: "in-process",
      schedulingImpl: "legacy",
    },
  ]);
});

test("odpResolve defaults to deployment manifest (all legacy by default)", () => {
  const resolved = odpResolve(DEFAULT_DEPLOYMENT_MANIFEST);
  const keys = resolved.map((r) => r.pipelineKey).sort();
  assert.deepEqual(keys, ["geo-enrich", "parse", "tracking"]);
  for (const entry of resolved) {
    assert.equal(entry.runtime, "legacy", `${entry.pipelineKey} must default to legacy runtime`);
  }
});
