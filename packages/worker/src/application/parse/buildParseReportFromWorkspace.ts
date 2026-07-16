import type { EventType, ParseReport, ParseWorkspace } from "@radar/shared";
import { parseReportSchema } from "@radar/shared";
import { createHash } from "node:crypto";
import { PARSER_VERSION } from "../../domain/parsing/version.js";
import { inferSeverity } from "../../domain/parsing/inferSeverity.js";
import { resolveEventTypeForCandidate } from "../../domain/parse/resolveEventTypeForCandidate.js";
import { materializeCandidateExtras } from "../../domain/parse/resolveTraitsForCandidate.js";

type BuildReportInput = {
  workspace: ParseWorkspace;
  rawText: string;
  postedAt?: string;
  channelKey?: string;
  file?: string;
  index?: number;
  geoPipeline?: ParseReport["geoPipeline"];
  geoArtifact?: ParseReport["geoArtifact"];
};

/** Проекция ParseWorkspace → ParseReport (CLI / offline). */
export function buildParseReportFromWorkspace(input: BuildReportInput): ParseReport {
  const hash = createHash("sha256").update(input.rawText, "utf8").digest("hex");
  const primary = input.workspace.candidates[0];
  const resolvedType = primary
    ? resolveEventTypeForCandidate(primary, input.workspace)
    : "unknown";
  const isEvent = Boolean(primary && resolvedType !== "unknown");

  return parseReportSchema.parse({
    index: input.index,
    file: input.file,
    raw: {
      text: input.rawText,
      hash,
      channelKey: input.channelKey,
      postedAt: input.postedAt,
      rawMessageId: input.workspace.rawMessageId,
    },
    classification: isEvent
      ? { kind: "event" as const }
      : { kind: "noise" as const, reason: "event_type_not_detected" },
    event: primary && resolvedType !== "unknown"
      ? (() => {
          const extras = materializeCandidateExtras(primary, input.workspace);
          return {
            eventType: resolvedType as EventType,
            severity: inferSeverity(input.workspace.groomedText, resolvedType),
            repeat: Boolean(extras.repeat),
            count: typeof extras.count === "number" ? extras.count : undefined,
          };
        })()
      : undefined,
    geo: {
      regions: [],
      places: input.workspace.candidates
        .filter((c) => c.anchor.kind === "place" || c.anchor.kind === "region")
        .map((c) => ({
          name: c.anchor.name,
          kind: c.anchor.kind === "region" ? ("city" as const) : ("city" as const),
          lat: c.anchor.lat,
          lon: c.anchor.lon,
        })),
      precision: "unknown",
      completeness: 0,
      source: "local",
    },
    enrich: {
      invoked: false,
      providersTried: [],
      hits: 0,
      misses: 0,
      cacheHit: false,
    },
    diagnostics: {
      parserVersion: PARSER_VERSION,
      warnings: [],
    },
    geoPipeline: input.geoPipeline,
    geoArtifact: input.geoArtifact,
    candidates: input.workspace.candidates,
    workspace: input.workspace,
  });
}