import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvOverlay } from "./applyEnvOverlay.js";

const ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

const base = {
  version: 1,
  infra: { obs: { dockerize: false, mode: "embedded" as const } },
  runners: {
    pipelines: [
      { pipelineKey: "tracking", schedulingImpl: "legacy", enabled: true },
      { pipelineKey: "parse", schedulingImpl: "legacy", enabled: true },
    ],
  },
};

test("applyEnvOverlay patches nested scalar paths", () => {
  const result = applyEnvOverlay(base, "DEPLOY", {
    DEPLOY__infra__obs__dockerize: "true",
    DEPLOY__infra__obs__mode: "service",
  });
  assert.equal(result.infra.obs.dockerize, true);
  assert.equal(result.infra.obs.mode, "service");
});

test("applyEnvOverlay patches keyed array by pipelineKey", () => {
  const result = applyEnvOverlay(base, "DEPLOY", {
    DEPLOY__runners__pipelines__tracking__schedulingImpl: "runner-platform",
    DEPLOY__runners__pipelines__parse__enabled: "false",
  }, ARRAY_KEYS);
  const tracking = result.runners.pipelines.find((p) => p.pipelineKey === "tracking");
  const parse = result.runners.pipelines.find((p) => p.pipelineKey === "parse");
  assert.equal(tracking?.schedulingImpl, "runner-platform");
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
