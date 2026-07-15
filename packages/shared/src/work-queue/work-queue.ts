/**
 * Unified pipeline — порт очереди работ: plan → take batch → mark*.
 */

export type WorkItemOutcome = "completed" | "failed" | "skipped";

export type WorkItemResult = {
  outcome: WorkItemOutcome;
  detail?: string;
};

/** Порт механики job-таблицы (не «одно задание»). */
export interface IWorkQueue<TWorkItem> {
  planPending(limit?: number): Promise<{ planned: number }>;
  claimBatch(limit: number): Promise<TWorkItem[]>;
  markCompleted(id: string, result?: WorkItemResult): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
