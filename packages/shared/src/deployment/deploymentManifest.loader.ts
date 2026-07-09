/**
 * ---
 * layer: shared/deployment
 * domain: deployment
 * purpose: Node-only загрузка deployment.manifest.json с fs (не для browser bundle).
 * ---
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyDeploymentEnvOverlay,
  applyDeploymentInfraEnv,
  DEFAULT_DEPLOYMENT_MANIFEST,
  deploymentManifestSchema,
  type DeploymentManifest,
} from "./deploymentManifest.schema.js";

export { applyDeploymentInfraEnv };

export type LoadDeploymentManifestOptions = {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
};

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function deepMergeManifest(base: DeploymentManifest, patch: unknown): DeploymentManifest {
  if (!patch || typeof patch !== "object") return base;
  const p = patch as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base, ...p };
  if (p.runners && typeof p.runners === "object") {
    const runners = p.runners as Record<string, unknown>;
    if (Array.isArray(runners.pipelines)) {
      merged.runners = { ...base.runners, pipelines: runners.pipelines };
    }
  }
  if (p.infra && typeof p.infra === "object") {
    const infra = p.infra as Record<string, unknown>;
    const obs =
      infra.obs && typeof infra.obs === "object"
        ? { ...base.infra.obs, ...(infra.obs as Record<string, unknown>) }
        : base.infra.obs;
    merged.infra = { ...base.infra, ...infra, obs };
  }
  return deploymentManifestSchema.parse(merged);
}

/**
 * Загружает deployment.manifest.json (+ deployment.local.json) с env overlay.
 * Отсутствующий файл → DEFAULT_DEPLOYMENT_MANIFEST.
 */
export function loadDeploymentManifest(
  options: LoadDeploymentManifestOptions,
): DeploymentManifest {
  const basePath = join(options.repoRoot, "deployment.manifest.json");
  const localPath = join(options.repoRoot, "deployment.local.json");

  let manifest = DEFAULT_DEPLOYMENT_MANIFEST;
  const baseRaw = readJsonFile(basePath);
  if (baseRaw) manifest = deepMergeManifest(DEFAULT_DEPLOYMENT_MANIFEST, baseRaw);

  const localRaw = readJsonFile(localPath);
  if (localRaw) manifest = deepMergeManifest(manifest, localRaw);

  return applyDeploymentEnvOverlay(manifest, options.env ?? process.env);
}
