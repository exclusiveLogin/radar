/**
 * ---
 * layer: worker/composition
 * domain: odp
 * purpose: Разрешает infra manifest в runtime-статус каждого pipeline —
 *          стартовый лог composition root и Admin/Web UI Workbook Registry.
 * ---
 */
import {
  type InfraManifest,
  type DeploymentHost,
  type DeploymentSpawn,
} from "@radar/shared";
import { loadInfraManifest } from "@radar/shared/infra/infraManifest.loader.js";
import { MONOREPO_ROOT } from "@repo/root";
import type { OdpPipelineKey } from "./odpManifest.js";

export type OdpPipelineRuntime = "runner-platform";

export type OdpResolution = {
  pipelineKey: OdpPipelineKey;
  label: string;
  runtime: OdpPipelineRuntime;
  host: DeploymentHost;
  spawn: DeploymentSpawn;
};

export function odpResolve(
  manifest: InfraManifest = loadInfraManifest({ repoRoot: MONOREPO_ROOT }),
): OdpResolution[] {
  return manifest.runners.pipelines.map((entry) => ({
    pipelineKey: entry.pipelineKey,
    label: entry.label,
    runtime: "runner-platform",
    host: entry.host,
    spawn: entry.spawn,
  }));
}
