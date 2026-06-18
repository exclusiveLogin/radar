import type { AttachRule, EventCandidate, ParseWorkspace, TraitAttachment } from "@radar/shared";
import { randomUUID } from "node:crypto";

/** Какие candidates получают trait по AttachRule. */
export function resolveAttachTargets(
  workspace: ParseWorkspace,
  rule: AttachRule,
): EventCandidate[] {
  const candidates = workspace.candidates;
  if (candidates.length === 0) return [];

  switch (rule.scope) {
    case "all_candidates":
      return candidates;
    case "by_kind":
      return candidates.filter((c) => c.anchor.kind === rule.kind);
    case "by_event_type":
      return candidates.filter((c) => c.eventType === rule.type);
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

/** Применяет trait к extras выбранных candidates. */
export function applyTraitToCandidates(input: {
  workspace: ParseWorkspace;
  attachment: TraitAttachment;
}): void {
  const targets = resolveAttachTargets(input.workspace, input.attachment.attachRule);
  for (const candidate of targets) {
    candidate.extras = {
      ...candidate.extras,
      [input.attachment.traitKey]: input.attachment.value,
    };
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
