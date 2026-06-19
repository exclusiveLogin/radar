import type { EnricherId, EventCandidate, ParseWorkspace } from "@radar/shared";
import {
  buildCandidateId,
  buildCandidateMergeKey,
} from "@radar/shared";
import { getEnricherTrust } from "./parseEnricherRegistry.js";

export type AppendCandidateInput = {
  workspace: ParseWorkspace;
  authorProcessorId: string;
  authorEnricherId: EnricherId;
  anchor: EventCandidate["anchor"];
  eventType: string;
  extras?: Record<string, unknown>;
  provenance: EventCandidate["provenance"];
  trust?: number;
};

/** Append-only: добавить кандидата с author/trust/mergeKey. */
export function appendCandidate(input: AppendCandidateInput): EventCandidate {
  const trust = input.trust ?? getEnricherTrust(input.authorEnricherId);
  const mergeKey = buildCandidateMergeKey({
    spanStart: input.anchor.span.start,
    spanEnd: input.anchor.span.end,
    anchorKind: input.anchor.kind,
    anchorName: input.anchor.name,
    regionCode: input.anchor.regionCode,
    placeId: input.anchor.placeId,
  });
  const candidate: EventCandidate = {
    id: buildCandidateId({
      rawMessageId: input.workspace.rawMessageId,
      spanStart: input.anchor.span.start,
      spanEnd: input.anchor.span.end,
      anchorKind: input.anchor.kind,
      anchorName: input.anchor.name,
      authorProcessorId: input.authorProcessorId,
    }),
    anchor: input.anchor,
    eventType: input.eventType,
    extras: input.extras ?? {},
    provenance: input.provenance,
    authorProcessorId: input.authorProcessorId,
    authorEnricherId: input.authorEnricherId,
    status: "active",
    mergeKey,
    trust,
  };
  input.workspace.candidates.push(candidate);
  return candidate;
}

/** Отклонить только своих candidates (append-only CRDT). */
export function rejectOwnCandidates(input: {
  workspace: ParseWorkspace;
  authorProcessorId: string;
  predicate?: (candidate: EventCandidate) => boolean;
}): number {
  let count = 0;
  for (const candidate of input.workspace.candidates) {
    if (candidate.authorProcessorId !== input.authorProcessorId) continue;
    if (candidate.status === "rejected") continue;
    if (input.predicate && !input.predicate(candidate)) continue;
    candidate.status = "rejected";
    count += 1;
  }
  return count;
}

/** Запись в namespace enricher/processor (не мутировать чужие ключи). */
export function writeNamespaceSlice<T extends Record<string, unknown>>(
  workspace: ParseWorkspace,
  key: string,
  slice: T,
): void {
  workspace.namespaces[key] = {
    ...(workspace.namespaces[key] as Record<string, unknown> | undefined),
    ...slice,
  };
}

/** Кандидаты enricher/processor. */
export function listCandidatesByAuthor(
  workspace: ParseWorkspace,
  authorProcessorId: string,
): EventCandidate[] {
  return workspace.candidates.filter(
    (c) => c.authorProcessorId === authorProcessorId && c.status === "active",
  );
}

/** Active candidates по mergeKey. */
export function listActiveCandidates(workspace: ParseWorkspace): EventCandidate[] {
  return workspace.candidates.filter((c) => c.status === "active");
}
