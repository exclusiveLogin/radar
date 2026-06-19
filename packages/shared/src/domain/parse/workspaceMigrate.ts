import {
  buildCandidateId,
  buildCandidateMergeKey,
} from "./candidateKeys.js";
import type { EventCandidate, ParseWorkspace, ParseWorkspaceV1 } from "../../schemas/parse/parse-workspace.js";

const DEFAULT_CATALOG_TRUST = 80;

/** v1 workspace из БД → v2 (author/trust/mergeKey). */
export function migrateParseWorkspaceV1ToV2(raw: ParseWorkspaceV1): ParseWorkspace {
  const candidates: EventCandidate[] = raw.candidates.map((candidate) => {
    const authorProcessorId =
      candidate.provenance.eventTypeSource.split(":")[0] ?? "legacy-processor";
    const mergeKey = buildCandidateMergeKey({
      spanStart: candidate.anchor.span.start,
      spanEnd: candidate.anchor.span.end,
      anchorKind: candidate.anchor.kind,
      anchorName: candidate.anchor.name,
      regionCode: candidate.anchor.regionCode,
      placeId: candidate.anchor.placeId,
    });
    return {
      ...candidate,
      authorProcessorId,
      authorEnricherId: "catalog",
      status: "active" as const,
      mergeKey,
      trust: DEFAULT_CATALOG_TRUST,
      id: buildCandidateId({
        rawMessageId: raw.rawMessageId,
        spanStart: candidate.anchor.span.start,
        spanEnd: candidate.anchor.span.end,
        anchorKind: candidate.anchor.kind,
        anchorName: candidate.anchor.name,
        authorProcessorId,
      }),
    };
  });

  return {
    schemaVersion: 2,
    rawMessageId: raw.rawMessageId,
    groomedText: raw.groomedText,
    blocks: raw.blocks,
    candidates,
    traitAttachments: raw.traitAttachments,
    namespaces: raw.namespaces,
    processorLog: raw.processorLog,
    enricherRunLog: [],
  };
}

/** Нормализация workspace из БД (v1 или v2). */
export function normalizeParseWorkspace(raw: unknown): ParseWorkspace {
  const parsed = raw as { schemaVersion?: number };
  if (parsed?.schemaVersion === 2) {
    return raw as ParseWorkspace;
  }
  return migrateParseWorkspaceV1ToV2(raw as ParseWorkspaceV1);
}
