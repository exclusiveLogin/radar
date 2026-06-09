/**
 * Worker CLI progress — обёртка над @radar/shared с gate для подавления шумных логов.
 */
export {
  createStageProgressReporter,
  type CreateProgressOptions,
  type ProgressCounters,
  type ProgressHandle,
  type StageProgressHandle,
  type StageProgressReporter,
} from "@radar/shared";
import { createProgress as createSharedProgress, type ProgressHandle } from "@radar/shared";
import { setCliProgressActive } from "../infrastructure/cliProgressGate.js";

export function createProgress(label: string, total: number): ProgressHandle {
  return createSharedProgress(label, total, { onActiveChange: setCliProgressActive });
}
