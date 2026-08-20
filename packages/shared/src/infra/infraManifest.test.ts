import assert from "node:assert/strict";
import test from "node:test";
import { applyEnvOverlay } from "../manifest/applyEnvOverlay.js";
import {
  DEFAULT_INFRA_MANIFEST,
  infraManifestSchema,
} from "../infra/infraManifest.schema.js";

const ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

test("DEFAULT_INFRA_MANIFEST has three pipeline entries", () => {
  assert.equal(DEFAULT_INFRA_MANIFEST.runners.pipelines.length, 3);
  assert.equal(DEFAULT_INFRA_MANIFEST.version, 1);
  assert.equal(DEFAULT_INFRA_MANIFEST.process.storageMode, "db");
  assert.equal(DEFAULT_INFRA_MANIFEST.transport.kind, "rmq");
  assert.equal("role" in DEFAULT_INFRA_MANIFEST.process, false);
});

test("INFRA__ env overlay patches runners.pipelines by pipelineKey", () => {
  const merged = applyEnvOverlay(DEFAULT_INFRA_MANIFEST, "INFRA", {
    INFRA__infra__obs__dockerize: "true",
    INFRA__infra__obs__mode: "service",
    INFRA__runners__pipelines__tracking__enabled: "false",
    INFRA__runners__pipelines__parse__spawn: "docker",
    INFRA__process__storageMode: "fs",
  }, ARRAY_KEYS);
  const manifest = infraManifestSchema.parse(merged);
  assert.equal(manifest.infra.obs.dockerize, true);
  assert.equal(manifest.infra.obs.mode, "service");
  assert.equal(manifest.process.storageMode, "fs");
  const tracking = manifest.runners.pipelines.find((p) => p.pipelineKey === "tracking");
  const parse = manifest.runners.pipelines.find((p) => p.pipelineKey === "parse");
  assert.equal(tracking?.enabled, false);
  assert.equal(parse?.spawn, "docker");
});

test("infraManifestSchema validates root manifest shape", () => {
  const parsed = infraManifestSchema.parse({
    version: 1,
    process: { storageMode: "db" },
    runners: { pipelines: [] },
    infra: { obs: {}, compose: {} },
    transport: { kind: "rmq" },
  });
  assert.equal(parsed.version, 1);
  assert.equal(parsed.infra.obs.dockerize, false);
});
