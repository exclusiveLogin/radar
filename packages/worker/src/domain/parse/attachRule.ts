import type { AttachRule, EventCandidate, ParseWorkspace, TraitAttachment } from "@radar/shared";
import { randomUUID } from "node:crypto";

function spansOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/** Какие candidates получают trait по AttachRule. */
export function resolveAttachTargets(
  workspace: ParseWorkspace,
  rule: AttachRule,
): EventCandidate[] {
  const candidates = workspace.candidates.filter((c) => c.status === "active");
  if (candidates.length === 0) return [];

  switch (rule.scope) {
    case "all_candidates":
      return candidates;
    case "by_kind":
      return candidates.filter((c) => c.anchor.kind === rule.kind);
    case "by_event_type":
      return candidates.filter((c) => c.eventType === rule.type);
    case "by_span_overlap":
      return candidates.filter((c) => spansOverlap(c.anchor.span, rule.span));
    case "by_candidate_ids":
      return candidates.filter((c) => rule.ids.includes(c.id));
    case "first":
      return [candidates[0]!];
    case "last":
      return [candidates[candidates.length - 1]!];
    case "system":
      return candidates.filter((c) => c.anchor.kind === "system");
    default:
      return [];
  }
}

export function createTraitAttachment(input: {
  processorId: string;
  traitKey: string;
  value: unknown;
  attachRule: AttachRule;
  matchedText?: string;
}): TraitAttachment {
  return {
    id: randomUUID(),
    processorId: input.processorId,
    traitKey: input.traitKey,
    value: input.value,
    attachRule: input.attachRule,
    provenance: input.matchedText ? { matchedText: input.matchedText } : undefined,
  };
}
