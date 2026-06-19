import type { EventCandidate, ParseWorkspace, TraitAttachment } from "@radar/shared";
import { resolveAttachTargets } from "./attachRule.js";

/** Ключи traits — только из traitAttachments, не in-place на candidate. */
export const TRAIT_EXTRAS_KEYS = ["repeat", "mass", "count"] as const;

/** Приоритет processor при конфликте одного traitKey (выше = winner). */
const TRAIT_PROCESSOR_PRIORITY: Record<string, number> = {
  "llm-processor": 90,
  "repeat-processor": 80,
  "mass-processor": 70,
  "count-processor": 60,
};

function traitProcessorPriority(processorId: string): number {
  return TRAIT_PROCESSOR_PRIORITY[processorId] ?? 0;
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
 * Traits для candidate из traitAttachments (SSOT).
 * Конфликт одного traitKey: выше priority processor; при равенстве — позже в массиве.
 */
export function resolveTraitsForCandidate(
  candidate: EventCandidate,
  attachments: TraitAttachment[],
  workspace: ParseWorkspace,
): Record<string, unknown> {
  const matching = attachments
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => attachmentMatchesCandidate(candidate, attachment, workspace))
    .sort((a, b) => {
      const pa = traitProcessorPriority(a.attachment.processorId);
      const pb = traitProcessorPriority(b.attachment.processorId);
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    });

  const resolved: Record<string, unknown> = {};
  for (const { attachment } of matching) {
    resolved[attachment.traitKey] = attachment.value;
  }
  return resolved;
}

/** Candidate extras для materialize: anchor-owned + projected traits. */
export function materializeCandidateExtras(
  candidate: EventCandidate,
  workspace: ParseWorkspace,
): Record<string, unknown> {
  const base = { ...candidate.extras };
  for (const key of TRAIT_EXTRAS_KEYS) {
    delete base[key];
  }
  const traits = resolveTraitsForCandidate(
    candidate,
    workspace.traitAttachments,
    workspace,
  );
  return { ...base, ...traits };
}
