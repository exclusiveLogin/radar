/**
 * ---
 * layer: shared/deployment
 * domain: deployment
 * purpose: Node-only загрузка deployment.manifest.json с fs (не для browser bundle).
 * ---
 */
import {
  DEFAULT_DEPLOYMENT_MANIFEST,
  deploymentManifestSchema,
  type DeploymentManifest,
} from "./deploymentManifest.schema.js";
import { loadDomainManifest } from "../manifest/loadDomainManifest.js";

export type LoadDeploymentManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

const DEPLOYMENT_ARRAY_KEYS = { "runners.pipelines": "pipelineKey" };

/** Загружает deployment manifest (ADR-021: generic loader + DEPLOY__ env). */
export function loadDeploymentManifest(
  options: LoadDeploymentManifestOptions,
): DeploymentManifest {
  return loadDomainManifest<DeploymentManifest>({
    repoRoot: options.repoRoot,
    env: options.env,
    fileBase: "deployment",
    envPrefix: "DEPLOY",
    schema: deploymentManifestSchema,
    defaults: DEFAULT_DEPLOYMENT_MANIFEST,
    arrayKeys: DEPLOYMENT_ARRAY_KEYS,
    legacyLocalFiles: ["deployment.local.json"],
  });
}
