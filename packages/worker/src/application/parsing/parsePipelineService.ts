import type {
  EventLocation,
  GeoPipelineReport,
  IEventClassifier,
  ParseReport,
  ParsedEvent,
} from "@radar/shared";
import { parseReportSchema } from "@radar/shared";
import { createHash } from "node:crypto";
import type { LocationResolutionService } from "./locationResolutionService.js";

export type ParsePipelineResult = {
  report: ParseReport;
  parsedEvent?: ParsedEvent;
  locations: EventLocation[];
  geoPipeline?: GeoPipelineReport;
};

export class ParsePipelineService {
  constructor(
    private readonly classifier: IEventClassifier,
    private readonly resolution: LocationResolutionService,
  ) {}

  async execute(input: {
    rawText: string;
    postedAt?: string;
    channelKey?: string;
    rawMessageId?: string;
    file?: string;
    index?: number;
  }): Promise<ParsePipelineResult> {
    const classified = this.classifier.classify(input.rawText);
    const hash = createHash("sha256").update(input.rawText, "utf8").digest("hex");

    if (classified.kind !== "event") {
      const report = parseReportSchema.parse({
        index: input.index,
        file: input.file,
        raw: {
          text: input.rawText,
          hash,
          channelKey: input.channelKey,
          postedAt: input.postedAt,
          rawMessageId: input.rawMessageId,
        },
        classification: {
          kind: classified.kind,
          reason: classified.reason,
        },
        geo: {
          regions: [],
          precision: "unknown",
          completeness: 0,
          source: "local",
          places: [],
        },
        enrich: {
          invoked: false,
          providersTried: [],
          hits: 0,
          misses: 0,
          cacheHit: false,
        },
        diagnostics: {
          parserVersion: "0.1.0",
          warnings: [],
        },
      });
      return { report, locations: [], geoPipeline: undefined };
    }

    const parsedEvent: ParsedEvent = {
      ...classified.event,
      rawMessageId: input.rawMessageId ?? classified.event.rawMessageId,
      postedAt: input.postedAt ?? classified.event.postedAt,
    };

    const resolved = await this.resolution.resolve(input.rawText);
    const finalizer = resolved.artifact.finalizer;

    const precision = finalizer?.precision ?? "unknown";
    const completeness = finalizer?.completeness ?? 0;
    const source = finalizer?.source ?? "local";

    const regions = finalizer?.regions ?? [];
    const places = finalizer?.places ?? [];
    const invoked = Boolean(
      resolved.artifact.dadata ?? resolved.artifact.nominatim ?? resolved.artifact.llm,
    );
    const providersTried: string[] = [];
    if (resolved.artifact.dadata) providersTried.push("dadata");
    if (resolved.artifact.nominatim) providersTried.push("nominatim");
    if (resolved.artifact.llm) providersTried.push("llm");
    const cacheHit =
      (resolved.artifact.dadata?.cacheHit ?? false) ||
      (resolved.artifact.nominatim?.cacheHit ?? false);

    const report = parseReportSchema.parse({
      index: input.index,
      file: input.file,
      raw: {
        text: input.rawText,
        hash,
        channelKey: input.channelKey,
        postedAt: parsedEvent.postedAt,
        rawMessageId: parsedEvent.rawMessageId,
      },
      classification: { kind: "event" },
      event: {
        eventType: parsedEvent.eventType,
        severity: parsedEvent.severity,
        repeat: parsedEvent.repeat,
        count: parsedEvent.count,
        direction: parsedEvent.direction,
        macroZone: parsedEvent.macroZone,
      },
      geo: {
        regions,
        places,
        precision,
        completeness,
        source,
      },
      enrich: {
        invoked,
        providersTried,
        hits: resolved.locations.length,
        misses: resolved.locations.length > 0 ? 0 : 1,
        cacheHit,
      },
      diagnostics: {
        parserVersion: parsedEvent.parserVersion,
        warnings: [],
      },
      geoPipeline: resolved.geoPipeline,
      geoArtifact: resolved.artifact,
    });

    return {
      report,
      parsedEvent,
      locations: resolved.locations,
      geoPipeline: resolved.geoPipeline,
    };
  }
}
