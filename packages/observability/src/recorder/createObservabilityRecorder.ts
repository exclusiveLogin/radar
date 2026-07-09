import type { IObservabilityRecorder } from "@radar/shared";
import type { DataSource } from "typeorm";
import { HttpObservabilityRecorder } from "./httpObservabilityRecorder.js";
import { NoopObservabilityRecorder } from "./noopObservabilityRecorder.js";
import { SqlObservabilityRecorder } from "./sqlObservabilityRecorder.js";

/** Режим write-path observability. */
export type ObsRecorderMode = "embedded" | "service" | "noop";

export type CreateObservabilityRecorderOptions = {
  mode: ObsRecorderMode;
  serviceUrl?: string;
  dataSource?: DataSource;
};

/** Factory: embedded SQL, HTTP sidecar или noop. */
export function createObservabilityRecorder(
  options: CreateObservabilityRecorderOptions,
): IObservabilityRecorder {
  if (options.mode === "service") {
    return new HttpObservabilityRecorder(options.serviceUrl);
  }
  if (options.mode === "embedded" && options.dataSource) {
    return new SqlObservabilityRecorder(options.dataSource);
  }
  return new NoopObservabilityRecorder();
}
