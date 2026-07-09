import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDeploymentEnvOverlay,
  DEFAULT_DEPLOYMENT_MANIFEST,
  deploymentManifestSchema,
} from "./deploymentManifest.schema.js";

test("DEFAULT_DEPLOYMENT_MANIFEST has three pipeline entries", () => {
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.runners.pipelines.length, 3);
  assert.equal(DEFAULT_DEPLOYMENT_MANIFEST.version, 1);
});

test("applyDeploymentEnvOverlay maps DEPLOY_PIPELINE_* and legacy runner flags", () => {
  const manifest = applyDeploymentEnvOverlay(DEFAULT_DEPLOYMENT_MANIFEST, {
    DEPLOY_OBS_DOCKERIZE: "1",
    DEPLOY_PIPELINE_TRACKING_SCHEDULING: "runner-platform",
    TRACKING_RUNNER_PLATFORM_ENABLED: "true",
    PARSE_RUNNER_PLATFORM_ENABLED: "true",
  });

  assert.equal(manifest.infra.obs.dockerize, true);
  const tracking = manifest.runners.pipelines.find((p) => p.pipelineKey === "tracking");
  const parse = manifest.runners.pipelines.find((p) => p.pipelineKey === "parse");
  assert.equal(tracking?.schedulingImpl, "runner-platform");
  assert.equal(parse?.schedulingImpl, "runner-platform");
});

test("deploymentManifestSchema validates root manifest shape", () => {
  const parsed = deploymentManifestSchema.parse({
    version: 1,
    runners: { pipelines: [] },
    infra: { obs: {} },
    transport: {},
  });
  assert.deepEqual(parsed.transport, {});
});
