import type { EventCandidate, ParseWorkspace } from "@radar/shared";

export type ContinuationStatus = "warning" | "danger";

export type ContinuationFact = {
  statusCode: ContinuationStatus;
  regionCode: string;
};

function continuationStatus(text: string): ContinuationStatus | null {
  const normalized = text.toLocaleLowerCase("ru-RU");
  if (!normalized.includes("сохраняется")) return null;
  if (normalized.includes("опасность")) return "danger";
  if (normalized.includes("внимание")) return "warning";
  return null;
}

function uniqueRegionCodes(candidates: EventCandidate[]): string[] {
  return [
    ...new Set(
      candidates
        .map((candidate) => candidate.anchor.regionCode?.trim())
        .filter((code): code is string => Boolean(code)),
    ),
  ];
}

/**
 * «Отбой» и «сохраняется» — независимые факты одного сообщения.
 * Явный регион приоритетнее region единственного place-якоря.
 */
export function extractContinuationFact(workspace: ParseWorkspace): ContinuationFact | null {
  const statusCode = continuationStatus(workspace.groomedText);
  if (!statusCode) return null;

  const explicitRegions = uniqueRegionCodes(
    workspace.candidates.filter((candidate) => candidate.anchor.kind === "region"),
  );
  if (explicitRegions.length === 1) {
    return { statusCode, regionCode: explicitRegions[0]! };
  }
  if (explicitRegions.length > 1) return null;

  const fallbackRegions = uniqueRegionCodes(
    workspace.candidates.filter(
      (candidate) => candidate.status === "active" && candidate.anchor.kind === "place",
    ),
  );
  if (fallbackRegions.length !== 1) return null;
  return { statusCode, regionCode: fallbackRegions[0]! };
}
