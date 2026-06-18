import type { ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { groomMessage } from "./groomMessage.js";
import { loadProcessorRegistry, registryRevisionHash, runProcessorPipeline } from "./processorRegistry.js";

export type OrchestratorResult =
  | { kind: "noise" | "meta"; reason: string }
  | { kind: "event"; workspace: ParseWorkspace; parserRevision: string };

/** Сборка workspace: groom → processor pipeline. */
export function runParseWorkspaceOrchestrator(input: {
  rawMessageId: string;
  rawText: string;
  geoCatalog: GeoCatalog;
}): OrchestratorResult {
  const groomed = groomMessage(input.rawText);
  if (groomed.kind !== "event") {
    return { kind: groomed.kind, reason: groomed.reason };
  }

  const registry = loadProcessorRegistry();
  const workspace: ParseWorkspace = {
    ...createEmptyParseWorkspace(input.rawMessageId, groomed.groomedText),
    blocks: groomed.blocks,
  };

  runProcessorPipeline({ workspace, geoCatalog: input.geoCatalog });

  const eventTypeFound = workspace.candidates.some((c) => c.eventType !== "unknown");
  if (!eventTypeFound && workspace.candidates.length === 0) {
    return { kind: "noise", reason: "event_type_not_detected" };
  }

  return {
    kind: "event",
    workspace,
    parserRevision: registryRevisionHash(registry),
  };
}
