import {
  createObservabilityRecorder as createObservabilityRecorderImpl,
  type CreateObservabilityRecorderOptions,
  type ObsRecorderMode,
} from "@radar/observability";
import type { IObservabilityRecorder } from "@radar/shared";

export type { CreateObservabilityRecorderOptions, ObsRecorderMode };

/** Делегат factory в @radar/observability (Iter 3). */
export function createObservabilityRecorder(
  options: CreateObservabilityRecorderOptions,
): IObservabilityRecorder {
  return createObservabilityRecorderImpl(options);
}
