import type { RuntimeObservabilitySnapshot } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  HttpObsReadClient,
  resolveObsReadModeFromEnv,
  resolveObsServiceUrl,
} from "./http-obs-read-client";
import { SqlObsReadClient } from "./sql-obs-read-client";

/** Контракт read-path observability (service HTTP или embedded SQL). */
export interface ObsReadClient {
  fetchRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot>;
}

/** Factory: RADAR_OBS_READ_MODE=service → HTTP, иначе SQL через DataSource. */
export function createObsReadClient(dataSource: DataSource): ObsReadClient {
  const mode = resolveObsReadModeFromEnv();
  if (mode === "service") {
    return new HttpObsReadClient(resolveObsServiceUrl());
  }
  return new SqlObsReadClient(dataSource);
}
