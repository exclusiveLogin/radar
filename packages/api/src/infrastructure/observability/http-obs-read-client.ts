import {
  runtimeObservabilitySnapshotSchema,
  type RuntimeObservabilitySnapshot,
} from "@radar/shared";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:3020";

/** SSOT URL obs-service read-path. */
export function resolveObsServiceUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.RADAR_OBS_SERVICE_URL?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_SERVICE_URL;
}

/** RADAR_OBS_READ_MODE=service|embedded (default embedded). */
export type ObsReadMode = "service" | "embedded";

export function resolveObsReadModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObsReadMode {
  const raw = env.RADAR_OBS_READ_MODE?.trim().toLowerCase();
  return raw === "service" ? "service" : "embedded";
}

/** HTTP read-client: GET /obs/v1/runtime/snapshot. */
export class HttpObsReadClient {
  constructor(private readonly serviceUrl: string = DEFAULT_SERVICE_URL) {}

  async fetchRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot> {
    const base = this.serviceUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/obs/v1/runtime/snapshot`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`obs snapshot failed: ${res.status} ${body}`);
    }
    const json: unknown = await res.json();
    return runtimeObservabilitySnapshotSchema.parse(json);
  }
}
