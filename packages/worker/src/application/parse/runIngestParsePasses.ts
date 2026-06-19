import type { PhaseDefinitionRecord } from "@radar/shared";
import type { ParseEnricherId } from "../../domain/parse/parseEnricherRegistry.js";
import { sortPhasesByOrder } from "../phases/phaseOrder.js";
import type { ParseWorkspaceMessageService, ParseWorkspaceRunResult } from "./ParseWorkspaceMessageService.js";
import { resolvePhaseRunKind } from "./parseWorkspaceRunModes.js";

export type IngestParsePassRecord = {
  phaseId: string;
  runKind: ReturnType<typeof resolvePhaseRunKind>;
  enrichers: ParseEnricherId[];
  result: ParseWorkspaceRunResult;
};

/**
 * Offline/prod-parity: последовательный прогон enabled ingestParse-фаз манифеста.
 * catalog (rebuild) → llm/dadata/… (phase_enrich) на том же rawMessageId.
 */
export async function runIngestParsePasses(input: {
  workspaceService: ParseWorkspaceMessageService;
  phases: PhaseDefinitionRecord[];
  rawMessageId: string;
  rawText: string;
  postedAt: string;
}): Promise<IngestParsePassRecord[]> {
  const passes: IngestParsePassRecord[] = [];
  let hasEventWorkspace = false;

  for (const phase of sortPhasesByOrder(input.phases)) {
    const runKind = resolvePhaseRunKind(phase);
    if (runKind === "phase_enrich" && !hasEventWorkspace) {
      continue;
    }

    const result = await input.workspaceService.run({
      rawMessageId: input.rawMessageId,
      rawText: input.rawText,
      postedAt: input.postedAt,
      runKind,
      geoContext: { enrichers: phase.enrichers as ParseEnricherId[] },
      mode: runKind === "phase_enrich" ? "refinalize" : "initial",
    });

    passes.push({
      phaseId: phase.id,
      runKind,
      enrichers: phase.enrichers as ParseEnricherId[],
      result,
    });

    if (result.kind === "event") {
      hasEventWorkspace = true;
      continue;
    }

    if (runKind === "rebuild") {
      break;
    }
  }

  return passes;
}

/** Последний успешный event-pass или undefined. */
export function lastEventPass(
  passes: IngestParsePassRecord[],
): Extract<ParseWorkspaceRunResult, { kind: "event" }> | undefined {
  for (let i = passes.length - 1; i >= 0; i -= 1) {
    const row = passes[i]!;
    if (row.result.kind === "event") {
      return row.result;
    }
  }
  return undefined;
}
