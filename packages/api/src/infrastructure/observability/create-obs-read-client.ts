import type { RuntimeObservabilitySnapshot } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  HttpObsReadClient,
  type ObsReadMode,
} from "./http-obs-read-client";
import { SqlObsReadClient } from "./sql-obs-read-client";

/** Контракт read-path observability (service HTTP или embedded SQL). */
export interface ObsReadClient {
  fetchRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot>;
}

export type ObsReadClientOptions = {
  readMode?: ObsReadMode;
  serviceUrl?: string;
};

/** Factory: readMode/serviceUrl из deployment manifest (передаёт factory). */
export function createObsReadClient(
  dataSource: DataSource,
  options: ObsReadClientOptions = {},
): ObsReadClient {
  const mode = options.readMode ?? "embedded";
  const serviceUrl = options.serviceUrl ?? "http://127.0.0.1:3020";
  if (mode === "service") {
    return new HttpObsReadClient(serviceUrl);
  }
  return new SqlObsReadClient(dataSource);
}
