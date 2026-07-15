/**
 * Unified pipeline — контракт claim/plan для parse + geo job tables.
 */

export type WorkItemOutcome = "completed" | "failed" | "skipped";

export type WorkItemResult = {
  outcome: WorkItemOutcome;
  detail?: string;
};

/** Единый интерфейс mechanics-слоя: plan → claim → mark*. */
export interface IWorkClaim<TWorkItem> {
  planPending(limit?: number): Promise<{ planned: number }>;
  claimBatch(limit: number): Promise<TWorkItem[]>;
  markCompleted(id: string, result?: WorkItemResult): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
