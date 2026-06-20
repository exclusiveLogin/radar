import type { ParseWorkspace } from "@radar/shared";
import { listCandidatesByAuthor } from "./parseProcessorContract.js";

const AUTHOR = "vicinity-processor";
const ENRICHER = "catalog";
const GEO_AUTHOR = "geo-processor";

const VICINITY_PATTERN = /\b(?:около|в\s+районе|рядом\s+с|вблизи)\b/iu;

/** Минимальный VicinityProcessor: trait vicinity по span window рядом с geo-hit. */
export function runVicinityProcessor(workspace: ParseWorkspace): void {
  const geoCandidates = listCandidatesByAuthor(workspace, GEO_AUTHOR);
  if (geoCandidates.length === 0) return;

  const text = workspace.groomedText;
  for (const candidate of geoCandidates) {
    const span = candidate.anchor.span;
    if (!span) continue;

    const windowStart = Math.max(0, span.start - 40);
    const windowEnd = Math.min(text.length, span.end + 40);
    const window = text.slice(windowStart, windowEnd);
    if (!VICINITY_PATTERN.test(window)) continue;

    candidate.extras = { ...candidate.extras, vicinity: true };
  }
}

export const VICINITY_PROCESSOR_ID = AUTHOR;
