import type { ExecutorStatus, IObservabilityRecorder } from "@radar/shared";
import { buildExecutorId, obsNow } from "./obsContext.js";

export type ParseWorkerPoolObs = {
  registerExecutors: (count: number) => void;
  markExecutor: (index: number, status: ExecutorStatus) => void;
  shutdownExecutors: () => void;
};

export type ParseWorkerPoolObsOptions = {
  recorder: IObservabilityRecorder;
  hostId: string;
};

/** Obs hooks для ParseWorkerPool: upsert thread executors по PK executor_id. */
export function createParseWorkerPoolObs(
  options: ParseWorkerPoolObsOptions,
): ParseWorkerPoolObs {
  const { recorder, hostId } = options;
  let poolSize = 0;

  function fireUpsertExecutor(index: number, status: ExecutorStatus): void {
    void recorder
      .upsertExecutor({
        executorId: buildExecutorId(hostId, index),
        hostId,
        kind: "thread",
        parentId: hostId,
        lastSeenAt: obsNow(),
        status,
      })
      .catch((err: unknown) => {
        console.warn("[obs] upsertExecutor failed:", err);
      });
  }

  return {
    registerExecutors(count) {
      poolSize = count;
      for (let i = 0; i < count; i += 1) {
        fireUpsertExecutor(i, "idle");
      }
    },
    markExecutor(index, status) {
      if (index < 0 || index >= poolSize) return;
      fireUpsertExecutor(index, status);
    },
    shutdownExecutors() {
      for (let i = 0; i < poolSize; i += 1) {
        fireUpsertExecutor(i, "stopped");
      }
    },
  };
}
