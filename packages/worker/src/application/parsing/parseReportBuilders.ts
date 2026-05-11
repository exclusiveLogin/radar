import type {
  EventLocation,
  GeoEnrichmentArtifact,
  GeoPipelineReport,
  ParseReport,
  ParsedEvent,
} from "@radar/shared";
import { parseReportSchema } from "@radar/shared";

type ParseInputMeta = {
  rawText: string;
  hash: string;
  postedAt?: string;
  channelKey?: string;
  rawMessageId?: string;
  file?: string;
  index?: number;
};

/** Builds parse report for non-event classifications (noise/meta). */
export function buildNonEventReport(options: {
  input: ParseInputMeta;
  kind: "noise" | "meta";
  reason: string;
}): ParseReport {
  const { input, kind, reason } = options;
  return parseReportSchema.parse({
    index: input.index,
    file: input.file,
    raw: {
      text: input.rawText,
      hash: input.hash,
      channelKey: input.channelKey,
      postedAt: input.postedAt,
      rawMessageId: input.rawMessageId,
    },
    classification: {
      kind,
      reason,
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
}

/** Builds parse report for event classification using resolved geo artifact. */
export function buildEventReport(options: {
  input: ParseInputMeta;
  parsedEvent: ParsedEvent;
  resolved: {
    locations: EventLocation[];
    artifact: GeoEnrichmentArtifact;
    geoPipeline: GeoPipelineReport;
  };
}): ParseReport {
  const { input, parsedEvent, resolved } = options;
  const finalizer = resolved.artifact.finalizer;
  const providersTried: string[] = [];
  if (resolved.artifact.dadata) providersTried.push("dadata");
  if (resolved.artifact.nominatim) providersTried.push("nominatim");
  if (resolved.artifact.llm) providersTried.push("llm");

  return parseReportSchema.parse({
    index: input.index,
    file: input.file,
    raw: {
      text: input.rawText,
      hash: input.hash,
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
      regions: finalizer?.regions ?? [],
      places: finalizer?.places ?? [],
      precision: finalizer?.precision ?? "unknown",
      completeness: finalizer?.completeness ?? 0,
      source: finalizer?.source ?? "local",
    },
    enrich: {
      invoked: Boolean(
        resolved.artifact.dadata ??
          resolved.artifact.nominatim ??
          resolved.artifact.llm,
      ),
      providersTried,
      hits: resolved.locations.length,
      misses: resolved.locations.length > 0 ? 0 : 1,
      cacheHit:
        (resolved.artifact.dadata?.cacheHit ?? false) ||
        (resolved.artifact.nominatim?.cacheHit ?? false),
    },
    diagnostics: {
      parserVersion: parsedEvent.parserVersion,
      warnings: [],
    },
    geoPipeline: resolved.geoPipeline,
    geoArtifact: resolved.artifact,
  });
}
