import type { IWorkQueue, WorkItemResult } from "@radar/shared";

export type UnifiedRunnerStats = {
  planned: number;
  claimed: number;
  processed: number;
  ok: number;
  failed: number;
  skipped: number;
};

export type UnifiedRunnerConfig<TWorkItem> = {
  queue: IWorkQueue<TWorkItem>;
  batchSize: number;
  handle: (item: TWorkItem) => Promise<WorkItemResult>;
};

/**
 * Один оборот жерновов: planPending → claimBatch → handle → mark*.
 */
export function createUnifiedRunner<TWorkItem>(
  config: UnifiedRunnerConfig<TWorkItem>,
): { drainOnce(): Promise<UnifiedRunnerStats> } {
  return {
    async drainOnce(): Promise<UnifiedRunnerStats> {
      const { planned } = await config.queue.planPending(config.batchSize);
      const batch = await config.queue.claimBatch(config.batchSize);
      const stats: UnifiedRunnerStats = {
        planned,
        claimed: batch.length,
        processed: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
      };

      for (const item of batch) {
        const id = (item as { id: string }).id;
        try {
          const result = await config.handle(item);
          stats.processed += 1;
          if (result.outcome === "completed") {
            stats.ok += 1;
            await config.queue.markCompleted(id, result);
          } else if (result.outcome === "skipped") {
            stats.skipped += 1;
            await config.queue.markCompleted(id, result);
          } else {
            stats.failed += 1;
            await config.queue.markFailed(id, result.detail ?? "failed");
          }
        } catch (error) {
          stats.processed += 1;
          stats.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          await config.queue.markFailed(id, message);
        }
      }

      return stats;
    },
  };
}
