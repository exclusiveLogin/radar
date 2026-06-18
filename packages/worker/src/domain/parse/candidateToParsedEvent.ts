import type { EventCandidate, ParsedEvent, ParseWorkspace } from "@radar/shared";
import { inferSeverity } from "../parsing/inferSeverity.js";
import { PARSER_VERSION } from "../parsing/version.js";

/** Проекция candidate → ParsedEvent для finalize и offline pipeline. */
export function candidateToParsedEvent(input: {
  workspace: ParseWorkspace;
  candidate: EventCandidate;
  postedAt: string;
  parserVersion?: string;
  locations?: ParsedEvent["locations"];
}): ParsedEvent {
  const { workspace, candidate, postedAt } = input;
  return {
    rawMessageId: workspace.rawMessageId,
    eventType: candidate.eventType as ParsedEvent["eventType"],
    severity: inferSeverity(workspace.groomedText, candidate.eventType),
    repeat: Boolean(candidate.extras.repeat),
    count: typeof candidate.extras.count === "number" ? candidate.extras.count : undefined,
    direction: typeof candidate.extras.direction === "string" ? candidate.extras.direction : undefined,
    macroZone:
      candidate.extras.macroZone === "rear"
      || candidate.extras.macroZone === "front"
      || candidate.extras.macroZone === "border"
        ? candidate.extras.macroZone
        : undefined,
    locations: input.locations ?? [],
    postedAt,
    parserVersion: input.parserVersion ?? PARSER_VERSION,
    confidence: 0.8,
    extras: {
      ...candidate.extras,
      candidateId: candidate.id,
      anchor: candidate.anchor,
    },
    isActive: true,
  };
}
