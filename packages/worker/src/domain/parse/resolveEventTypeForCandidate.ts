import type { AttachRule, EventCandidate, ParseWorkspace, TraitAttachment } from "@radar/shared";
import { resolveAttachTargets } from "./attachRule.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

export const EVENT_TYPE_TRAIT_KEY = "eventType";

/** Специфичность attachRule: уже span/id — выше all_candidates. */
function attachRuleSpecificity(rule: AttachRule): number {
  switch (rule.scope) {
    case "by_span_overlap":
      return 50;
    case "by_candidate_ids":
      return 45;
    case "by_kind":
      return 40;
    case "by_event_type":
      return 35;
    case "first":
    case "last":
      return 30;
    case "system":
      return 20;
    case "all_candidates":
      return 10;
    default:
      return 0;
  }
}

const EVENT_TYPE_PROCESSOR_PRIORITY: Record<string, number> = {
  "llm-processor": 90,
  "event-type-processor": 80,
};

function eventTypeProcessorPriority(processorId: string): number {
  return EVENT_TYPE_PROCESSOR_PRIORITY[processorId] ?? 0;
}

function attachmentMatchesCandidate(
  candidate: EventCandidate,
  attachment: TraitAttachment,
  workspace: ParseWorkspace,
): boolean {
  return resolveAttachTargets(workspace, attachment.attachRule).some(
    (target) => target.id === candidate.id,
  );
}

/**
 * eventType для materialize: candidate.eventType или traitAttachments (SSOT для enrichers).
 * Конфликт: выше specificity attachRule → выше processor priority.
 */
export function resolveEventTypeForCandidate(
  candidate: EventCandidate,
  workspace: ParseWorkspace,
): string {
  if (candidate.eventType !== "unknown") {
    return candidate.eventType;
  }

  const matching = workspace.traitAttachments
    .filter((attachment) => attachment.traitKey === EVENT_TYPE_TRAIT_KEY)
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => attachmentMatchesCandidate(candidate, attachment, workspace))
    .sort((a, b) => {
      const spec =
        attachRuleSpecificity(b.attachment.attachRule)
        - attachRuleSpecificity(a.attachment.attachRule);
      if (spec !== 0) return spec;
      const pa = eventTypeProcessorPriority(a.attachment.processorId);
      const pb = eventTypeProcessorPriority(b.attachment.processorId);
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    });

  const winner = matching[0]?.attachment.value;
  return typeof winner === "string" && winner.length > 0 ? winner : "unknown";
}

/** Candidate с resolved eventType для finalize / parsedEvent projection. */
export function withResolvedEventType(
  candidate: EventCandidate,
  workspace: ParseWorkspace,
): EventCandidate {
  const eventType = resolveEventTypeForCandidate(candidate, workspace);
  if (eventType === candidate.eventType) return candidate;
  return { ...candidate, eventType };
}

/**
 * Primary для report / offline projection: active с известным eventType,
 * иначе первый active. Rejected `[0]` не брать — иначе ложный noise.
 */
export function pickPrimaryCandidate(
  workspace: ParseWorkspace,
): EventCandidate | undefined {
  const active = listActiveCandidates(workspace);
  return active.find((c) => resolveEventTypeForCandidate(c, workspace) !== "unknown") ?? active[0];
}
