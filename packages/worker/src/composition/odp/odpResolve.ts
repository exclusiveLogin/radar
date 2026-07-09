/**
 * ---
 * layer: worker/composition
 * domain: odp
 * purpose: Разрешает deployment manifest в текущий рантайм-статус каждого pipeline — источник данных
 *          для стартового лога composition root и Admin/Web UI Workbook Registry.
 * ---
 */
import {
  type DeploymentManifest,
  type DeploymentHost,
  type DeploymentSpawn,
  type SchedulingImpl,
} from "@radar/shared";
import { loadDeploymentManifest } from "@radar/shared/deployment/deploymentManifest.loader.js";
import { MONOREPO_ROOT } from "@repo/root";
import type { OdpPipelineKey } from "./odpManifest.js";

export type OdpPipelineRuntime = "runner-platform" | "legacy";

export type OdpResolution = {
  pipelineKey: OdpPipelineKey;
  label: string;
  runtime: OdpPipelineRuntime;
  host: DeploymentHost;
  spawn: DeploymentSpawn;
  schedulingImpl: SchedulingImpl;
};

export function odpResolve(
  manifest: DeploymentManifest = loadDeploymentManifest({ repoRoot: MONOREPO_ROOT }),
): OdpResolution[] {
  return manifest.runners.pipelines.map((entry) => ({
    pipelineKey: entry.pipelineKey,
    label: entry.label,
    runtime: entry.schedulingImpl === "runner-platform" ? "runner-platform" : "legacy",
    host: entry.host,
    spawn: entry.spawn,
    schedulingImpl: entry.schedulingImpl,
  }));
}
