import type { FinalizeContext, ParsedEvent, ParseWorkspace } from "@radar/shared";
import { planFinalizeMerge } from "./planFinalizeMerge.js";

export type MaterializedEvent = {
  candidateId: string;
  parsedEvent: ParsedEvent;
  action: "insert" | "update";
  parsedEventId?: string;
};

export type FinalizePlan = {
  materialized: MaterializedEvent[];
  orphanIds: string[];
  invalidIds: string[];
};

/** Pure finalize planner: trust/CRDT merge + reconcile без IO. */
export function planFinalize(input: {
  workspace: ParseWorkspace;
  context: FinalizeContext;
  postedAt: string;
}): FinalizePlan {
  return planFinalizeMerge(input);
}
