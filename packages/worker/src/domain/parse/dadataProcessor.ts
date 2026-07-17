import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "dadata-processor";
const ENRICHER = "dadata";

/**
 * Dadata enricher processor: namespace slice + append geo-candidates из artifact.dadata.
 * HTTP вызов — в composition parse external enricher.
 */
export function runDadataProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const dadata = artifact?.dadata;
  writeNamespaceSlice(workspace, "dadata", {
    invoked: Boolean(dadata),
    processorId: AUTHOR,
    enricherId: ENRICHER,
    cacheHit: dadata?.cacheHit,
    nodeCount: dadata?.nodes?.length ?? 0,
  });

  if (!dadata?.nodes?.length) return;

  appendCandidatesFromGeoNodes({
    workspace,
    nodes: dadata.nodes,
    authorProcessorId: AUTHOR,
    authorEnricherId: ENRICHER,
  });
}
