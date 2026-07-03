/**
 * ---
 * layer: worker/composition
 * domain: odp
 * purpose: Разрешает ODP-манифест в текущий рантайм-статус каждого pipeline — источник данных
 *          для стартового лога composition root и (в дальнейшем) для Admin/Web UI Workbook Registry.
 * ---
 */
import { ODP_MANIFEST, type OdpManifestEntry, type OdpPipelineKey } from "./odpManifest.js";

export type OdpPipelineRuntime = "runner-platform" | "legacy";

export type OdpResolution = {
  pipelineKey: OdpPipelineKey;
  label: string;
  runtime: OdpPipelineRuntime;
};

export function odpResolve(
  manifest: readonly OdpManifestEntry[] = ODP_MANIFEST,
): OdpResolution[] {
  return manifest.map((entry) => ({
    pipelineKey: entry.pipelineKey,
    label: entry.label,
    runtime: entry.runnerPlatformEnabled() ? "runner-platform" : "legacy",
  }));
}
