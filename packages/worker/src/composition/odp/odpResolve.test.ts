import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_INFRA_MANIFEST } from "@radar/shared";
import { odpResolve } from "./odpResolve.js";

test("odpResolve maps pipelines to runner-platform runtime", () => {
  const manifest = {
    ...DEFAULT_INFRA_MANIFEST,
    runners: {
      pipelines: [
        {
          pipelineKey: "tracking" as const,
          label: "t",
          host: "tracking" as const,
          spawn: "in-process" as const,
          enabled: true,
        },
        {
          pipelineKey: "parse" as const,
          label: "p",
          host: "parse" as const,
          spawn: "in-process" as const,
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
    },
    {
      pipelineKey: "parse",
      label: "p",
      runtime: "runner-platform",
      host: "parse",
      spawn: "in-process",
    },
  ]);
});

test("odpResolve defaults to infra manifest runners", () => {
  const resolved = odpResolve(DEFAULT_INFRA_MANIFEST);
  const keys = resolved.map((r) => r.pipelineKey).sort();
  assert.deepEqual(keys, ["geo-enrich", "parse", "tracking"]);
  for (const entry of resolved) {
    assert.equal(entry.runtime, "runner-platform", `${entry.pipelineKey} must be runner-platform`);
  }
});
