import type { ParseWorkspace } from "@radar/shared";
import type { IPlaceScanPort } from "@radar/shared";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { groomMessage } from "./groomMessage.js";
import { runCatalogEnricher, parsePipelineRevisionHash } from "./parseEnricherRunner.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

export type OrchestratorResult =
  | { kind: "noise" | "meta"; reason: string }
  | { kind: "event"; workspace: ParseWorkspace; parserRevision: string };

/** Сборка workspace: groom → catalog enricher (processors). */
export function runParseWorkspaceOrchestrator(input: {
  rawMessageId: string;
  rawText: string;
  placeScan: IPlaceScanPort;
}): OrchestratorResult {
  const groomed = groomMessage(input.rawText);
  if (groomed.kind !== "event") {
    return { kind: groomed.kind, reason: groomed.reason };
  }

  const workspace: ParseWorkspace = {
    ...createEmptyParseWorkspace(input.rawMessageId, groomed.groomedText),
    blocks: groomed.blocks,
  };

  runCatalogEnricher({ workspace, placeScan: input.placeScan });

  const eventTypeFound = listActiveCandidates(workspace).some((c) => c.eventType !== "unknown");
  if (!eventTypeFound && workspace.candidates.length === 0) {
    return { kind: "noise", reason: "event_type_not_detected" };
  }

  return {
    kind: "event",
    workspace,
    parserRevision: parsePipelineRevisionHash(),
  };
}
