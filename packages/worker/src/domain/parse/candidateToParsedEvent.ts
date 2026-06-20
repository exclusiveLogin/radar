import type { EventCandidate, ParsedEvent, ParseWorkspace } from "@radar/shared";
import { inferSeverity } from "../parsing/inferSeverity.js";
import { PARSER_VERSION } from "../parsing/version.js";
import { withResolvedEventType } from "./resolveEventTypeForCandidate.js";
import { materializeCandidateExtras } from "./resolveTraitsForCandidate.js";

/** Проекция candidate → ParsedEvent для finalize и offline pipeline. */
export function candidateToParsedEvent(input: {
  workspace: ParseWorkspace;
  candidate: EventCandidate;
  postedAt: string;
  parserVersion?: string;
  locations?: ParsedEvent["locations"];
}): ParsedEvent {
  const { workspace, postedAt } = input;
  const candidate = withResolvedEventType(input.candidate, workspace);
  const extras = materializeCandidateExtras(candidate, workspace);
  return {
    rawMessageId: workspace.rawMessageId,
    eventType: candidate.eventType as ParsedEvent["eventType"],
    severity: inferSeverity(workspace.groomedText, candidate.eventType),
    repeat: Boolean(extras.repeat),
    count: typeof extras.count === "number" ? extras.count : undefined,
    direction: typeof extras.direction === "string" ? extras.direction : undefined,
    macroZone:
      extras.macroZone === "rear"
      || extras.macroZone === "front"
      || extras.macroZone === "border"
        ? extras.macroZone
        : undefined,
    locations: input.locations ?? [],
    postedAt,
    parserVersion: input.parserVersion ?? PARSER_VERSION,
    confidence: 0.8,
    extras: {
      ...extras,
      candidateId: candidate.id,
      anchor: candidate.anchor,
    },
    isActive: true,
  };
}
