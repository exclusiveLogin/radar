import type { ParseWorkspace } from "@radar/shared";
import { writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "nominatim-processor";
const ENRICHER = "nominatim";

/** Nominatim enricher processor: namespace slice (geo enrich). */
export function runNominatimProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as { nominatim?: unknown } | undefined;
  writeNamespaceSlice(workspace, "nominatim", {
    invoked: Boolean(artifact?.nominatim),
    processorId: AUTHOR,
    enricherId: ENRICHER,
  });
}
