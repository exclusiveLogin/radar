import { createHash } from "node:crypto";

/** Детерминированный id кандидата внутри workspace-run (SSOT для heal/re-finalize). */
export function buildCandidateId(input: {
  rawMessageId: string;
  spanStart: number;
  spanEnd: number;
  anchorKind: string;
  anchorName: string;
}): string {
  const normalizedName = input.anchorName.toLowerCase().replace(/ё/g, "е").trim();
  const payload = [
    input.rawMessageId,
    String(input.spanStart),
    String(input.spanEnd),
    input.anchorKind,
    normalizedName,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
}
