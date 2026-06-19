import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
  ParseReport,
  ParsedEvent,
  ParseWorkspace,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import type { IRegionRepository } from "@radar/shared";
import { candidateToParsedEvent } from "../../domain/parse/candidateToParsedEvent.js";
import { buildLocationsByCandidateId } from "../../domain/parse/deriveEventLocationsFromCandidate.js";
import { createEmptyParseWorkspace } from "../../domain/parse/parseWorkspaceFactory.js";
import { listActiveCandidates } from "../../domain/parse/parseProcessorContract.js";
import type { ParseWorkspaceMessageService } from "../parse/ParseWorkspaceMessageService.js";
import {
  lastEventPass,
  runIngestParsePasses,
  type IngestParsePassRecord,
} from "../parse/runIngestParsePasses.js";
import { buildParseReportFromWorkspace } from "./buildParseReportFromWorkspace.js";

export type ParsePipelineResult = {
  report: ParseReport;
  workspace?: ParseWorkspace;
  parsedEvents?: ParsedEvent[];
  parsedEvent?: ParsedEvent;
  locations: EventLocation[];
  /** Прогон фаз манифеста (prod-parity). */
  passes: IngestParsePassRecord[];
  artifact?: GeoEnrichmentArtifact;
  geoPipeline?: GeoPipelineReport;
};

export type ParsePipelineInput = {
  rawText: string;
  postedAt?: string;
  channelKey?: string;
  rawMessageId?: string;
  file?: string;
  index?: number;
};

export type ParsePipelineServiceDeps = {
  workspaceService: ParseWorkspaceMessageService;
  regions: IRegionRepository;
  geoCatalog: GeoCatalog;
  ingestParsePhases: PhaseDefinitionRecord[];
};

function enricherRunLogToGeoPipeline(workspace: ParseWorkspace): GeoPipelineReport {
  return {
    steps: workspace.enricherRunLog.map((entry) => ({
      id: entry.enricherId,
      ok: entry.ok,
      durationMs: entry.durationMs,
    })),
  };
}

function pickPrimaryCandidate(workspace: ParseWorkspace): ParseWorkspace["candidates"][number] | undefined {
  return (
    listActiveCandidates(workspace).find((c) => c.eventType !== "unknown")
    ?? listActiveCandidates(workspace)[0]
  );
}

async function collectMaterializedLocations(
  workspace: ParseWorkspace,
  candidateEventMap: Record<string, string>,
  regions: IRegionRepository,
  geoCatalog: GeoCatalog,
): Promise<EventLocation[]> {
  const byCandidate = await buildLocationsByCandidateId(workspace, regions, geoCatalog);
  const locations: EventLocation[] = [];
  for (const candidateId of Object.keys(candidateEventMap)) {
    locations.push(...(byCandidate[candidateId] ?? []));
  }
  return locations;
}

/** Offline parse: те же ingestParse-проходки, что prod (манифест → workspaceService.run). */
export class ParsePipelineService {
  constructor(private readonly deps: ParsePipelineServiceDeps) {}

  async execute(input: ParsePipelineInput): Promise<ParsePipelineResult> {
    const rawMessageId = input.rawMessageId ?? randomUUID();
    const postedAt = input.postedAt ?? new Date().toISOString();

    const passes = await runIngestParsePasses({
      workspaceService: this.deps.workspaceService,
      phases: this.deps.ingestParsePhases,
      rawMessageId,
      rawText: input.rawText,
      postedAt,
    });

    const eventPass = lastEventPass(passes);
    if (!eventPass) {
      return {
        report: buildParseReportFromWorkspace({
          workspace: createEmptyParseWorkspace(rawMessageId, input.rawText),
          rawText: input.rawText,
          postedAt,
          channelKey: input.channelKey,
          file: input.file,
          index: input.index,
        }),
        locations: [],
        passes,
      };
    }

    const { workspace, finalize } = eventPass;
    const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
    const locations = await collectMaterializedLocations(
      workspace,
      finalize.candidateEventMap,
      this.deps.regions,
      this.deps.geoCatalog,
    );
    const geoPipeline = enricherRunLogToGeoPipeline(workspace);

    const report = buildParseReportFromWorkspace({
      workspace,
      rawText: input.rawText,
      postedAt,
      channelKey: input.channelKey,
      file: input.file,
      index: input.index,
      geoPipeline,
      geoArtifact: artifact,
    });

    const primary = pickPrimaryCandidate(workspace);
    const parsedEvent = primary
      ? candidateToParsedEvent({
          workspace,
          candidate: primary,
          postedAt,
          parserVersion: "workspace",
          locations,
        })
      : undefined;

    return {
      report,
      workspace,
      parsedEvent,
      parsedEvents: parsedEvent ? [parsedEvent] : [],
      locations,
      passes,
      artifact,
      geoPipeline,
    };
  }
}
