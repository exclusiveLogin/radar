import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
  ParseReport,
  ParsedEvent,
  ParseWorkspace,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { candidateToParsedEvent } from "../../domain/parse/candidateToParsedEvent.js";
import { createEmptyParseWorkspace } from "../../domain/parse/parseWorkspaceFactory.js";
import { runParseWorkspaceOrchestrator } from "../../domain/parse/ParseWorkspaceOrchestrator.js";
import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";
import type { LocationResolutionService } from "./locationResolutionService.js";
import { buildParseReportFromWorkspace } from "./buildParseReportFromWorkspace.js";

export type ParsePipelineGeoContext = {
  initialArtifact?: GeoEnrichmentArtifact;
  priorValidatedLocations?: EventLocation[];
  phaseMode?: GeoPipelinePhaseMode;
};

export type ParsePipelineResult = {
  report: ParseReport;
  workspace?: ParseWorkspace;
  parsedEvents?: ParsedEvent[];
  parsedEvent?: ParsedEvent;
  locations: EventLocation[];
  geoPipeline?: GeoPipelineReport;
  artifact?: GeoEnrichmentArtifact;
};

export type ParsePipelineInput = {
  rawText: string;
  postedAt?: string;
  channelKey?: string;
  rawMessageId?: string;
  file?: string;
  index?: number;
  geoContext?: ParsePipelineGeoContext;
};

export class ParsePipelineService {
  constructor(
    private readonly resolution: LocationResolutionService,
    private readonly geoCatalog: GeoCatalog,
  ) {}

  async execute(input: ParsePipelineInput): Promise<ParsePipelineResult> {
    const rawMessageId = input.rawMessageId ?? randomUUID();
    const orchestrated = runParseWorkspaceOrchestrator({
      rawMessageId,
      rawText: input.rawText,
      geoCatalog: this.geoCatalog,
    });

    if (orchestrated.kind !== "event") {
      return {
        report: buildParseReportFromWorkspace({
          workspace: createEmptyParseWorkspace(rawMessageId, input.rawText),
          rawText: input.rawText,
          postedAt: input.postedAt,
          channelKey: input.channelKey,
          file: input.file,
          index: input.index,
        }),
        locations: [],
      };
    }

    const resolved = await this.resolution.resolve(input.rawText, input.geoContext ?? {});
    const report = buildParseReportFromWorkspace({
      workspace: orchestrated.workspace,
      rawText: input.rawText,
      postedAt: input.postedAt,
      channelKey: input.channelKey,
      file: input.file,
      index: input.index,
      geoPipeline: resolved.geoPipeline,
      geoArtifact: resolved.artifact,
    });

    const primary = orchestrated.workspace.candidates[0];
    const parsedEvent = primary
      ? candidateToParsedEvent({
          workspace: orchestrated.workspace,
          candidate: primary,
          postedAt: input.postedAt ?? new Date().toISOString(),
          parserVersion: "workspace",
          locations: resolved.locations,
        })
      : undefined;

    return {
      report,
      workspace: orchestrated.workspace,
      parsedEvent,
      parsedEvents: parsedEvent ? [parsedEvent] : [],
      locations: resolved.locations,
      geoPipeline: resolved.geoPipeline,
      artifact: resolved.artifact,
    };
  }
}
