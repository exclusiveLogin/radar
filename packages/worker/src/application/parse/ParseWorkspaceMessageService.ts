import type {
  EventLocation,
  FinalizeContext,
  ParseWorkspace,
} from "@radar/shared";
import { normalizeRegionCodeAlias } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { runParseWorkspaceOrchestrator } from "../../domain/parse/ParseWorkspaceOrchestrator.js";
import { ParseWorkspacePersistService } from "../parse/ParseWorkspacePersistService.js";
import type { LocationResolutionService } from "../parsing/locationResolutionService.js";
import type { GeoValidationService } from "../parsing/geoValidationService.js";

export type WorkspaceHandleDeps = {
  geoCatalog: GeoCatalog;
  resolution: LocationResolutionService;
  validation: GeoValidationService;
  persist: ParseWorkspacePersistService;
  findActiveWorkspace: (rawMessageId: string) => Promise<{
    spawnedEventIds: string[];
    candidateEventMap: Record<string, string>;
  } | null>;
};

function regionCodesMatch(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return normalizeRegionCodeAlias(left) === normalizeRegionCodeAlias(right);
}

/** Сопоставление validated locations с candidates по имени/коду региона. */
export function mapLocationsToCandidates(input: {
  workspace: ParseWorkspace;
  locations: EventLocation[];
}): Record<string, EventLocation[]> {
  const result: Record<string, EventLocation[]> = {};
  for (const candidate of input.workspace.candidates) {
    const matches = input.locations.filter((loc) => {
      if (candidate.anchor.kind === "region") {
        return regionCodesMatch(loc.regionCode, candidate.anchor.regionCode);
      }
      if (candidate.anchor.kind === "place") {
        const placeName = loc.placeName?.toLowerCase() ?? "";
        return placeName === candidate.anchor.name.toLowerCase();
      }
      return false;
    });
    result[candidate.id] = matches;
  }
  if (input.workspace.candidates.length === 1 && input.locations.length > 0) {
    const only = input.workspace.candidates[0]!;
    result[only.id] = input.locations;
  }
  return result;
}

export class ParseWorkspaceMessageService {
  constructor(private readonly deps: WorkspaceHandleDeps) {}

  async run(input: {
    rawMessageId: string;
    rawText: string;
    postedAt: string;
    geoContext?: {
      initialArtifact?: import("@radar/shared").GeoEnrichmentArtifact;
      priorValidatedLocations?: EventLocation[];
      phaseMode?: import("../geo-pipeline/GeoPipelineContext.js").GeoPipelinePhaseMode;
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

    const resolved = await this.deps.resolution.resolve(input.rawText, input.geoContext ?? {});
    const validated: EventLocation[] = [];
    for (const location of resolved.locations) {
      const decision = await this.deps.validation.validate(input.rawText, location, {});
      if (decision.location) validated.push(decision.location);
    }

    orchestrated.workspace.namespaces = {
      ...orchestrated.workspace.namespaces,
      geoArtifact: resolved.artifact,
    };

    const prior = await this.deps.findActiveWorkspace(input.rawMessageId);
    const context: FinalizeContext = {
      mode: input.mode ?? (prior ? "refinalize" : "initial"),
      existingSpawnedIds: prior?.spawnedEventIds ?? [],
      candidateEventMap: prior?.candidateEventMap ?? {},
      orphanPolicy: input.orphanPolicy ?? "deactivate",
    };

    const finalize = await this.deps.persist.finalize({
      workspace: orchestrated.workspace,
      context,
      postedAt: input.postedAt,
      parserRevision: orchestrated.parserRevision,
      locationsByCandidateId: mapLocationsToCandidates({
        workspace: orchestrated.workspace,
        locations: validated,
      }),
    });

    return { kind: "event", workspace: orchestrated.workspace, finalize };
  }
}
