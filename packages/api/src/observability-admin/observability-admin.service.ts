import { join } from "node:path";
import { createRequire } from "node:module";
import { Inject, Injectable } from "@nestjs/common";
import { runnerDiscoveryResponseSchema, type RunnerDiscoveryResponse } from "@radar/shared";
import {
  createObsReadClient,
  type ObsReadClient,
} from "../infrastructure/observability/create-obs-read-client";
import { MONOREPO_ROOT } from "../monorepo-root.js";
import { ReadSideQueryService } from "../read-side/read-side-query.service";
import { WorkbookAdminService } from "../workbook-admin/workbook-admin.service";

const nodeRequire = createRequire(__filename);

export const OBS_READ_CLIENT = Symbol("OBS_READ_CLIENT");

type InfraManifestModule = {
  loadInfraManifest: (opts: { repoRoot: string }) => {
    infra: { obs: { readMode: "embedded" | "service"; serviceUrl: string } };
  };
};

/**
 * Read-side merge: obs runtime snapshot + workbook workloads + stats overview.
 * Единая точка для GET /admin/runner/discovery и WS runtime-discovery.
 */
@Injectable()
export class ObservabilityAdminService {
  constructor(
    @Inject(OBS_READ_CLIENT) private readonly obsRead: ObsReadClient,
    private readonly workbook: WorkbookAdminService,
    private readonly readSide: ReadSideQueryService,
  ) {}

  async getDiscovery(): Promise<RunnerDiscoveryResponse> {
    const [runtime, workbook, stats] = await Promise.all([
      this.obsRead.fetchRuntimeSnapshot(),
      this.workbook.getObservability(),
      this.readSide.getStatsOverview(),
    ]);

    return runnerDiscoveryResponseSchema.parse({
      runtime,
      workbook,
      stats,
      generatedAt: new Date().toISOString(),
    });
  }
}

/** Nest factory: readMode из infra manifest. */
export function obsReadClientFactory(
  dataSource: Parameters<typeof createObsReadClient>[0],
): ObsReadClient {
  const loaderPath = join(
    MONOREPO_ROOT,
    "packages/shared/dist/infra/infraManifest.loader.js",
  );
  const { loadInfraManifest } = nodeRequire(loaderPath) as InfraManifestModule;
  const manifest = loadInfraManifest({ repoRoot: MONOREPO_ROOT });
  return createObsReadClient(dataSource, {
    readMode: manifest.infra.obs.readMode,
    serviceUrl: manifest.infra.obs.serviceUrl,
  });
}
