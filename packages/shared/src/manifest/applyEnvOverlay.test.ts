import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvOverlay } from "./applyEnvOverlay.js";

const ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

const base = {
  version: 1,
  infra: { obs: { dockerize: false, mode: "embedded" as const } },
  runners: {
    pipelines: [
      { pipelineKey: "tracking", enabled: true, spawn: "in-process" },
      { pipelineKey: "parse", enabled: true, spawn: "in-process" },
    ],
  },
};

test("applyEnvOverlay patches nested scalar paths", () => {
  const result = applyEnvOverlay(base, "INFRA", {
    INFRA__infra__obs__dockerize: "true",
    INFRA__infra__obs__mode: "service",
  });
  assert.equal(result.infra.obs.dockerize, true);
  assert.equal(result.infra.obs.mode, "service");
});

test("applyEnvOverlay patches keyed array by pipelineKey", () => {
  const result = applyEnvOverlay(base, "INFRA", {
    INFRA__runners__pipelines__tracking__spawn: "docker",
    INFRA__runners__pipelines__parse__enabled: "false",
  }, ARRAY_KEYS);
  const tracking = result.runners.pipelines.find((p) => p.pipelineKey === "tracking");
  const parse = result.runners.pipelines.find((p) => p.pipelineKey === "parse");
  assert.equal(tracking?.spawn, "docker");
  assert.equal(parse?.enabled, false);
});

test("applyEnvOverlay treats explicit false as boolean false", () => {
  const result = applyEnvOverlay(
    { flag: true, count: 5 },
    "TEST",
    { TEST__flag: "false", TEST__count: "0" },
  );
  assert.equal(result.flag, false);
  assert.equal(result.count, 0);
});
