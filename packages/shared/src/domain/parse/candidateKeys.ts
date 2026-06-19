import { createHash } from "node:crypto";

function normalizeAnchorName(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").trim();
}

/** CRDT-группа: один anchor в тексте — один mergeKey независимо от author. */
export function buildCandidateMergeKey(input: {
  spanStart: number;
  spanEnd: number;
  anchorKind: string;
  anchorName: string;
  regionCode?: string;
  placeId?: string;
}): string {
  const payload = [
    String(input.spanStart),
    String(input.spanEnd),
    input.anchorKind,
    input.regionCode ?? "",
    input.placeId ?? "",
    normalizeAnchorName(input.anchorName),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 24);
}

/** Id кандидата уникален per author (append-only CRDT). */
export function buildCandidateId(input: {
  rawMessageId: string;
  spanStart: number;
  spanEnd: number;
  anchorKind: string;
  anchorName: string;
  authorProcessorId: string;
}): string {
  const payload = [
    input.rawMessageId,
    String(input.spanStart),
    String(input.spanEnd),
    input.anchorKind,
    normalizeAnchorName(input.anchorName),
    input.authorProcessorId,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
}
