/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Materialize-порт для tracking workload — фиксирует результат тика в БД
 *          (watermark, run stats, finish/fail run). Сам батч (writeTracksL1 + consumed)
 *          уже сохраняется внутри `runIncrementalBatch` (существующий алгоритм, не трогаем
 *          в этой волне) — здесь только lifecycle-хвост, который в legacy-демоне жил
 *          внутри processTick.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  advanceTrackingWatermark,
  finishTrackingRun,
  updateTrackingRunStats,
} from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";
import type { TrackingRunnerArtifact } from "./trackingRunnerContracts.js";

/**
 * Ошибки батча обрабатываются внутри evaluate (см. trackingRunnerEval.ts) — там же, где есть
 * доступ к run.id в момент падения; materialize видит только успешный путь тика.
 */
export function createTrackingMaterialize(ds: DataSource) {
  return async function materializeTrackingArtifact(artifact: TrackingRunnerArtifact): Promise<void> {
    await updateTrackingRunStats(ds, artifact.runId, artifact.stats);

    if (artifact.result?.watermark) {
      await advanceTrackingWatermark(
        ds,
        artifact.result.watermark,
        artifact.runId,
        Number(artifact.stats.totalCandidates ?? 0),
      );
    }

    if (artifact.stats.stage === "done") {
      await finishTrackingRun(ds, artifact.runId, artifact.stats, Number(artifact.stats.pendingCandidates ?? 0));
    }
  };
}
