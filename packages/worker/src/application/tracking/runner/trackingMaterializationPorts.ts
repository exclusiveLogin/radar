/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Materialize-порт для lifecycle run. Сам батч атомарно сохраняет
 *          tracks/nodes, consumed, flow snapshot и watermark в runIncrementalBatch;
 *          здесь остаются stats и завершение run.
 * ---
 */
import type { DataSource } from "typeorm";
import {
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

    if (artifact.stats.stage === "done") {
      await finishTrackingRun(ds, artifact.runId, artifact.stats, Number(artifact.stats.pendingCandidates ?? 0));
    }
  };
}
