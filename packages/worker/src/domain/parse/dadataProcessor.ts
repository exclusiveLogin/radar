import type { ParseWorkspace } from "@radar/shared";
import { writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "dadata-processor";
const ENRICHER = "dadata";

/** Dadata enricher processor: namespace slice (geo enrich). */
export function runDadataProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as { dadata?: unknown } | undefined;
  writeNamespaceSlice(workspace, "dadata", {
    invoked: Boolean(artifact?.dadata),
    processorId: AUTHOR,
    enricherId: ENRICHER,
  });
}
