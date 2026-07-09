import type {
  FinalizeContext,
  FinalizeResult,
  IPlaceRepository,
  IRegionRepository,
  IPlaceScanPort,
  ParseWorkspace,
} from "@radar/shared";
import { normalizeParseWorkspace } from "@radar/shared";
import type { GeoValidationService } from "./geoValidationService.js";
import { planFinalize } from "../../domain/parse/ParseFinalizerService.js";
import { buildMaterializedEventLocations } from "../../domain/parse/buildMaterializedEventLocations.js";
import { runParseWorkspaceOrchestrator } from "../../domain/parse/ParseWorkspaceOrchestrator.js";
import type { ParseEnricherId } from "../../domain/parse/parseEnricherRegistry.js";
import { invokeExternalParseEnricher } from "../../domain/parse/invokeExternalParseEnricher.js";
import {
  parsePipelineRevisionHash,
  runParseEnricher,
} from "../../domain/parse/parseEnricherRunner.js";
import { ParseWorkspacePersistService } from "./ParseWorkspacePersistService.js";
import {
  type ParseWorkspaceRunKind,
  phaseEnrichersToRun,
} from "./parseWorkspaceRunModes.js";

/** Активная строка work_parse_message для phase_enrich / heal. */
export type StoredParseWorkspace = {
  workspace: ParseWorkspace;
  spawnedEventIds: string[];
  candidateEventMap: Record<string, string>;
  parserRevision: string;
  groomedText: string;
};

export type WorkspaceHandleDeps = {
  placeScan: IPlaceScanPort;
  regions: IRegionRepository;
  places: IPlaceRepository;
  validation: GeoValidationService;
  persist: ParseWorkspacePersistService;
  loadStoredWorkspace: (rawMessageId: string) => Promise<StoredParseWorkspace | null>;
};

const DEFAULT_ENRICHERS: ParseEnricherId[] = ["catalog"];

export type ParseWorkspaceRunInput = {
  rawMessageId: string;
  rawText: string;
  postedAt: string;
  /** rebuild | phase_enrich | heal — см. parseWorkspaceRunModes.ts */
  runKind?: ParseWorkspaceRunKind;
  geoContext?: {
    initialArtifact?: import("@radar/shared").GeoEnrichmentArtifact;
    enrichers?: ParseEnricherId[];
  };
  orphanPolicy?: FinalizeContext["orphanPolicy"];
  mode?: FinalizeContext["mode"];
};

export type ParseWorkspaceRunResult =
  | { kind: "noise" | "meta"; reason: string }
  | { kind: "event"; workspace: ParseWorkspace; finalize: FinalizeResult };

/**
 * Единая точка parse → finalize.
 * @see ./parseWorkspaceRunModes.ts
 */
export class ParseWorkspaceMessageService {
  constructor(private readonly deps: WorkspaceHandleDeps) {}

  async run(input: ParseWorkspaceRunInput): Promise<ParseWorkspaceRunResult> {
    const runKind = input.runKind ?? "rebuild";
    if (runKind === "heal") {
      return this.runHeal(input);
    }
    if (runKind === "phase_enrich") {
      return this.runPhaseEnrich(input);
    }
    return this.runRebuild(input);
  }

  /** Контур 1: raw → catalog orchestrator → enrichers → finalize. */
  private async runRebuild(input: ParseWorkspaceRunInput): Promise<ParseWorkspaceRunResult> {
    const orchestrated = runParseWorkspaceOrchestrator({
      rawMessageId: input.rawMessageId,
      rawText: input.rawText,
      placeScan: this.deps.placeScan,
    });
    if (orchestrated.kind !== "event") {
      return orchestrated;
    }

    const workspace = orchestrated.workspace;
    if (input.geoContext?.initialArtifact) {
      workspace.namespaces.geoArtifact = input.geoContext.initialArtifact;
    }

    await this.runEnrichers(workspace, input.geoContext?.enrichers ?? DEFAULT_ENRICHERS);

    const prior = await this.deps.loadStoredWorkspace(input.rawMessageId);
    const context: FinalizeContext = {
      mode: input.mode ?? (prior ? "refinalize" : "initial"),
      existingSpawnedIds: prior?.spawnedEventIds ?? [],
      candidateEventMap: prior?.candidateEventMap ?? {},
      orphanPolicy: input.orphanPolicy ?? "deactivate",
    };

    return this.finalizeWorkspace({
      workspace,
      context,
      postedAt: input.postedAt,
      parserRevision: orchestrated.parserRevision,
    });
  }

  /** Контур 2: load workspace из БД → enricher(ы) фазы → finalize(refinalize). */
  private async runPhaseEnrich(input: ParseWorkspaceRunInput): Promise<ParseWorkspaceRunResult> {
    const stored = await this.deps.loadStoredWorkspace(input.rawMessageId);
    if (!stored) {
      return this.runRebuild(input);
    }

    const workspace = structuredClone(stored.workspace);
    if (input.geoContext?.initialArtifact) {
      workspace.namespaces.geoArtifact = input.geoContext.initialArtifact;
    }

    const enrichers = phaseEnrichersToRun(
      input.geoContext?.enrichers ?? DEFAULT_ENRICHERS,
    );
    if (enrichers.length > 0) {
      await this.runEnrichers(workspace, enrichers);
    }

    const context: FinalizeContext = {
      mode: input.mode ?? "refinalize",
      existingSpawnedIds: stored.spawnedEventIds,
      candidateEventMap: stored.candidateEventMap,
      orphanPolicy: input.orphanPolicy ?? "deactivate",
    };

    return this.finalizeWorkspace({
      workspace,
      context,
      postedAt: input.postedAt,
      parserRevision: parsePipelineRevisionHash(),
    });
  }

  /** Контур 3: load workspace → только finalizer(heal), без enricher/orchestrator. */
  private async runHeal(input: ParseWorkspaceRunInput): Promise<ParseWorkspaceRunResult> {
    const stored = await this.deps.loadStoredWorkspace(input.rawMessageId);
    if (!stored) {
      return { kind: "meta", reason: "heal_no_active_workspace" };
    }

    const context: FinalizeContext = {
      mode: "heal",
      existingSpawnedIds: stored.spawnedEventIds,
      candidateEventMap: stored.candidateEventMap,
      orphanPolicy: input.orphanPolicy ?? "deactivate",
    };

    return this.finalizeWorkspace({
      workspace: stored.workspace,
      context,
      postedAt: input.postedAt,
      parserRevision: stored.parserRevision,
    });
  }

  private async runEnrichers(workspace: ParseWorkspace, enrichers: ParseEnricherId[]): Promise<void> {
    for (const enricherId of enrichers) {
      if (enricherId === "catalog") continue;
      await invokeExternalParseEnricher(enricherId, workspace);
      runParseEnricher(enricherId, { workspace, placeScan: this.deps.placeScan });
    }
  }

  private async finalizeWorkspace(input: {
    workspace: ParseWorkspace;
    context: FinalizeContext;
    postedAt: string;
    parserRevision: string;
  }): Promise<Extract<ParseWorkspaceRunResult, { kind: "event" }>> {
    const plan = planFinalize({
      workspace: input.workspace,
      context: input.context,
      postedAt: input.postedAt,
    });
    const locationsByCandidateId = await buildMaterializedEventLocations({
      workspace: input.workspace,
      materializedCandidateIds: plan.materialized.map((item) => item.candidateId),
      regions: this.deps.regions,
      places: this.deps.places,
      validation: this.deps.validation,
    });
    const finalize = await this.deps.persist.finalize({
      workspace: input.workspace,
      context: input.context,
      postedAt: input.postedAt,
      parserRevision: input.parserRevision,
      locationsByCandidateId,
    });
    return { kind: "event", workspace: input.workspace, finalize };
  }
}
