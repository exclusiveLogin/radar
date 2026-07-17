import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvOverlay } from "../manifest/applyEnvOverlay.js";
import {
  DEFAULT_DEPLOYMENT_MANIFEST,
  deploymentManifestSchema,
} from "./deploymentManifest.schema.js";

const ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

test("DEFAULT_DEPLOYMENT_MANIFEST has three pipeline entries", () => {
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.runners.pipelines.length, 3);
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.version, 1);
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.process.storageMode, "db");
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.transport.kind, "rmq");
  assert.equal("role" in DEFAULT_DEPLOYMENT_MANIFEST.process, false);
});

test("DEPLOY__ double-underscore env overlay patches pipelines and obs", () => {
  const merged = applyEnvOverlay(DEFAULT_DEPLOYMENT_MANIFEST, "DEPLOY", {
    DEPLOY__infra__obs__dockerize: "true",
    DEPLOY__infra__obs__mode: "service",
    DEPLOY__runners__pipelines__tracking__schedulingImpl: "runner-platform",
    DEPLOY__runners__pipelines__parse__schedulingImpl: "runner-platform",
    DEPLOY__process__storageMode: "fs",
  }, ARRAY_KEYS);
  const manifest = deploymentManifestSchema.parse(merged);

  assert.equal(manifest.infra.obs.dockerize, true);
  assert.equal(manifest.infra.obs.mode, "service");
  assert.equal(manifest.process.storageMode, "fs");
  const tracking = manifest.runners.pipelines.find((p) => p.pipelineKey === "tracking");
  const parse = manifest.runners.pipelines.find((p) => p.pipelineKey === "parse");
  assert.equal(tracking?.schedulingImpl, "runner-platform");
  assert.equal(parse?.schedulingImpl, "runner-platform");
});

test("deploymentManifestSchema validates root manifest shape", () => {
  const parsed = deploymentManifestSchema.parse({
    version: 1,
    process: { storageMode: "db" },
    runners: { pipelines: [] },
    infra: { obs: {}, compose: {} },
    transport: {},
  });
  assert.equal(parsed.transport.kind, "rmq");
  assert.equal(parsed.infra.compose.apiPort, 3000);
});