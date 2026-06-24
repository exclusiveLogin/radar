import type {
  EventCandidate,
  FinalizeContext,
  ParsedEvent,
  ParseWorkspace,
} from "@radar/shared";
import { extractNegativeMonitoringFlag } from "@radar/shared";
import { getProcessorTieBreak } from "./parseEnricherRegistry.js";
import { listActiveCandidates } from "./parseProcessorContract.js";
import { applyCandidateCollapsers } from "./candidateCollapsers.js";
import { candidateToParsedEvent } from "./candidateToParsedEvent.js";
import { isCandidateGeoValid } from "./geoPolicy.js";
import { withResolvedEventType } from "./resolveEventTypeForCandidate.js";
import type { FinalizePlan, MaterializedEvent } from "./ParseFinalizerService.js";

/** Выбор winner в CRDT-группе: trust → processor tie-break. */
export function pickMergeWinner(group: EventCandidate[]): EventCandidate {
  return [...group].sort((a, b) => {
    if (b.trust !== a.trust) return b.trust - a.trust;
    return getProcessorTieBreak(b.authorProcessorId) - getProcessorTieBreak(a.authorProcessorId);
  })[0]!;
}

/** Группировка active candidates по mergeKey. */
export function groupCandidatesByMergeKey(
  candidates: EventCandidate[],
): Map<string, EventCandidate[]> {
  const groups = new Map<string, EventCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.mergeKey) ?? [];
    list.push(candidate);
    groups.set(candidate.mergeKey, list);
  }
  return groups;
}

/**
 * Terminal finalizer: trust/CRDT merge → collapsers → geoPolicy → materialize.
 * Порядок enricher-ов не влияет на winner.
 */
export function planFinalizeMerge(input: {
  workspace: ParseWorkspace;
  context: FinalizeContext;
  postedAt: string;
}): FinalizePlan {
  const { workspace, context, postedAt } = input;
  const materialized: MaterializedEvent[] = [];
  const usedIds = new Set<string>();
  const invalidIds: string[] = [];

  const groups = groupCandidatesByMergeKey(listActiveCandidates(workspace));
  const winners: EventCandidate[] = [];
  for (const group of groups.values()) {
    winners.push(pickMergeWinner(group));
  }

  const collapsed = applyCandidateCollapsers(winners, workspace);

  const skipMaterialize = extractNegativeMonitoringFlag(workspace.groomedText);
  if (skipMaterialize) {
    const orphanIds = context.existingSpawnedIds.filter((id) => !usedIds.has(id));
    return { materialized: [], orphanIds, invalidIds: context.existingSpawnedIds };
  }

  for (const candidate of collapsed) {
    const resolved = withResolvedEventType(candidate, workspace);
    if (resolved.eventType === "unknown" || !isCandidateGeoValid({
      eventType: resolved.eventType,
      anchorKind: resolved.anchor.kind,
      massClearChannel: resolved.extras.massClearChannel === true,
    })) {
      const priorId = context.candidateEventMap[candidate.id];
      if (priorId) invalidIds.push(priorId);
      continue;
    }

    const parsedEventId = context.candidateEventMap[candidate.id];
    const parsedEvent = candidateToParsedEvent({ workspace, candidate: resolved, postedAt });
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

/** @deprecated Используйте planFinalizeMerge */
export function planFinalize(input: {
  workspace: ParseWorkspace;
  context: FinalizeContext;
  postedAt: string;
}): FinalizePlan {
  return planFinalizeMerge(input);
}

export type { MaterializedEvent, FinalizePlan, ParsedEvent };
