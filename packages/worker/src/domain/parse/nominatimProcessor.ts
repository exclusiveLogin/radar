import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "nominatim-processor";
const ENRICHER = "nominatim";

/**
 * Nominatim enricher processor: namespace slice + append geo-candidates из artifact.nominatim.
 * HTTP вызов — в composition parse external enricher.
 */
export function runNominatimProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const nominatim = artifact?.nominatim;
  writeNamespaceSlice(workspace, "nominatim", {
    invoked: Boolean(nominatim),
    processorId: AUTHOR,
    enricherId: ENRICHER,
    cacheHit: nominatim?.cacheHit,
    nodeCount: nominatim?.nodes?.length ?? 0,
  });

  if (!nominatim?.nodes?.length) return;

  appendCandidatesFromGeoNodes({
    workspace,
    nodes: nominatim.nodes,
    authorProcessorId: AUTHOR,
    authorEnricherId: ENRICHER,
  });
}
