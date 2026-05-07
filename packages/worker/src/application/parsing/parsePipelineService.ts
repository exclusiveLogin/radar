import type {
  EventLocation,
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
  diagnostics: {
    invoked: boolean;
    cacheHit: boolean;
    provider?: "dadata" | "nominatim" | "llm";
    regionDetected: boolean;
    localPlacesFound: number;
  };
};

function normalizePrecision(locations: EventLocation[]): {
  precision: "unknown" | "region" | "district" | "locality" | "locality_with_coords";
  completeness: number;
} {
  if (locations.length === 0) {
    return { precision: "unknown", completeness: 0 };
  }

  let best = 0;
  for (const location of locations) {
    let score = 0.25;
    if (location.precision === "district") score = 0.5;
    if (location.precision === "city" || location.precision === "locality") score = 0.75;
    if (location.lat !== undefined && location.lon !== undefined) score = 1;
    if (score > best) best = score;
  }

  if (best >= 1) {
    return { precision: "locality_with_coords", completeness: 1 };
  }
  if (best >= 0.75) {
    return { precision: "locality", completeness: 0.75 };
  }
  if (best >= 0.5) {
    return { precision: "district", completeness: 0.5 };
  }
  return { precision: "region", completeness: 0.25 };
}

function deriveSource(input: {
  locations: EventLocation[];
  provider?: "dadata" | "nominatim" | "llm";
  cacheHit: boolean;
}): "local" | "cache" | "dadata" | "nominatim" | "llm" {
  if (input.cacheHit) {
    return "cache";
  }
  if (input.provider) {
    return input.provider;
  }
  const first = input.locations[0];
  if (!first) {
    return "local";
  }
  if (first.source === "db") {
    return "local";
  }
  if (first.source === "cache") {
    return "cache";
  }
  return first.source;
}

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
      return {
        report,
        locations: [],
        diagnostics: {
          invoked: false,
          cacheHit: false,
          regionDetected: false,
          localPlacesFound: 0,
        },
      };
    }

    const parsedEvent: ParsedEvent = {
      ...classified.event,
      rawMessageId: input.rawMessageId ?? classified.event.rawMessageId,
      postedAt: input.postedAt ?? classified.event.postedAt,
    };

    const resolved = await this.resolution.resolve(input.rawText);
    const normalized = normalizePrecision(resolved.locations);
    const source = deriveSource({
      locations: resolved.locations,
      provider: resolved.diagnostics.provider,
      cacheHit: resolved.diagnostics.cacheHit,
    });
    const primaryRegion = resolved.locations[0];

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
      classification: {
        kind: "event",
      },
      event: {
        eventType: parsedEvent.eventType,
        severity: parsedEvent.severity,
        repeat: parsedEvent.repeat,
        count: parsedEvent.count,
        direction: parsedEvent.direction,
        macroZone: parsedEvent.macroZone,
      },
      geo: {
        region: primaryRegion
          ? {
              code: primaryRegion.regionCode,
              name: primaryRegion.placeName ?? primaryRegion.regionCode,
              fiasId: primaryRegion.regionFias,
            }
          : undefined,
        places: resolved.locations.map((location) => ({
          name: location.placeName ?? location.regionCode,
          kind:
            location.precision === "district"
              ? "district"
              : location.precision === "settlement"
                ? "settlement"
                : location.precision === "city"
                  ? "city"
                  : "locality",
          fiasId: location.placeFias,
          lat: location.lat,
          lon: location.lon,
        })),
        precision: normalized.precision,
        completeness: normalized.completeness,
        source,
      },
      enrich: {
        invoked: resolved.diagnostics.invoked,
        providersTried: resolved.diagnostics.provider ? [resolved.diagnostics.provider] : [],
        hits: resolved.locations.length,
        misses: resolved.locations.length > 0 ? 0 : 1,
        cacheHit: resolved.diagnostics.cacheHit,
      },
      diagnostics: {
        parserVersion: parsedEvent.parserVersion,
        warnings: [],
      },
    });

    return {
      report,
      parsedEvent,
      locations: resolved.locations,
      diagnostics: resolved.diagnostics,
    };
  }
}
