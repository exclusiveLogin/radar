import type {
  EventLocation,
  FinalizeContext,
  ParseWorkspace,
} from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { runParseWorkspaceOrchestrator } from "../../domain/parse/ParseWorkspaceOrchestrator.js";
import { runParseEnricher } from "../../domain/parse/parseEnricherRunner.js";
import type { ParseEnricherId } from "../../domain/parse/parseEnricherRegistry.js";
import { deriveEventLocationsFromCandidate } from "../../domain/parse/deriveEventLocationsFromCandidate.js";
import { listActiveCandidates } from "../../domain/parse/parseProcessorContract.js";
import { ParseWorkspacePersistService } from "./ParseWorkspacePersistService.js";

export type WorkspaceHandleDeps = {
  geoCatalog: GeoCatalog;
  persist: ParseWorkspacePersistService;
  findActiveWorkspace: (rawMessageId: string) => Promise<{
    spawnedEventIds: string[];
    candidateEventMap: Record<string, string>;
  } | null>;
};

/** Локации для materialized candidates (без parallel geo-pipeline). */
export function buildLocationsByCandidateId(
  workspace: ParseWorkspace,
): Record<string, EventLocation[]> {
  const result: Record<string, EventLocation[]> = {};
  for (const candidate of listActiveCandidates(workspace)) {
    result[candidate.id] = deriveEventLocationsFromCandidate(candidate);
  }
  return result;
}

const DEFAULT_ENRICHERS: ParseEnricherId[] = ["catalog"];

export class ParseWorkspaceMessageService {
  constructor(private readonly deps: WorkspaceHandleDeps) {}

  async run(input: {
    rawMessageId: string;
    rawText: string;
    postedAt: string;
    geoContext?: {
      initialArtifact?: import("@radar/shared").GeoEnrichmentArtifact;
      priorValidatedLocations?: EventLocation[];
      enrichers?: ParseEnricherId[];
    };
    orphanPolicy?: FinalizeContext["orphanPolicy"];
    mode?: FinalizeContext["mode"];
  }): Promise<
    | { kind: "noise" | "meta"; reason: string }
    | {
        kind: "event";
        workspace: ParseWorkspace;
        finalize: import("@radar/shared").FinalizeResult;
      }
  > {
    const orchestrated = runParseWorkspaceOrchestrator({
      rawMessageId: input.rawMessageId,
      rawText: input.rawText,
      geoCatalog: this.deps.geoCatalog,
    });
    if (orchestrated.kind !== "event") {
      return orchestrated;
    }

    const workspace = orchestrated.workspace;
    if (input.geoContext?.initialArtifact) {
      workspace.namespaces.geoArtifact = input.geoContext.initialArtifact;
    }

    const enrichers = input.geoContext?.enrichers ?? DEFAULT_ENRICHERS;
    for (const enricherId of enrichers) {
      if (enricherId === "catalog") continue;
      runParseEnricher(enricherId, { workspace, geoCatalog: this.deps.geoCatalog });
    }

    const prior = await this.deps.findActiveWorkspace(input.rawMessageId);
    const context: FinalizeContext = {
      mode: input.mode ?? (prior ? "refinalize" : "initial"),
      existingSpawnedIds: prior?.spawnedEventIds ?? [],
      candidateEventMap: prior?.candidateEventMap ?? {},
      orphanPolicy: input.orphanPolicy ?? "deactivate",
    };

    const finalize = await this.deps.persist.finalize({
      workspace,
      context,
      postedAt: input.postedAt,
      parserRevision: orchestrated.parserRevision,
      locationsByCandidateId: buildLocationsByCandidateId(workspace),
    });

    return { kind: "event", workspace, finalize };
  }
}
