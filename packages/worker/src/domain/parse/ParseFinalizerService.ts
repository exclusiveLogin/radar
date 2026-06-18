import type {
  FinalizeContext,
  ParsedEvent,
  ParseWorkspace,
} from "@radar/shared";
import { candidateToParsedEvent } from "./candidateToParsedEvent.js";
import { isCandidateGeoValid } from "./geoPolicy.js";

export type MaterializedEvent = {
  candidateId: string;
  parsedEvent: ParsedEvent;
  action: "insert" | "update";
  parsedEventId?: string;
};

export type FinalizePlan = {
  materialized: MaterializedEvent[];
  orphanIds: string[];
  invalidIds: string[];
};

/** Pure finalize planner: reconcile без IO. */
export function planFinalize(input: {
  workspace: ParseWorkspace;
  context: FinalizeContext;
  postedAt: string;
}): FinalizePlan {
  const { workspace, context, postedAt } = input;
  const materialized: MaterializedEvent[] = [];
  const usedIds = new Set<string>();
  const invalidIds: string[] = [];

  for (const candidate of workspace.candidates) {
    if (candidate.eventType === "unknown" || !isCandidateGeoValid({
      eventType: candidate.eventType,
      anchorKind: candidate.anchor.kind,
    })) {
      const priorId = context.candidateEventMap[candidate.id];
      if (priorId) invalidIds.push(priorId);
      continue;
    }

    const parsedEventId = context.candidateEventMap[candidate.id];
    const parsedEvent = candidateToParsedEvent({ workspace, candidate, postedAt });
    materialized.push({
      candidateId: candidate.id,
      parsedEvent,
      action: parsedEventId ? "update" : "insert",
      parsedEventId,
    });
    if (parsedEventId) usedIds.add(parsedEventId);
  }

  const orphanIds = context.existingSpawnedIds.filter((id) => !usedIds.has(id));

  return { materialized, orphanIds, invalidIds };
}
