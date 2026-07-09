import { Inject, Injectable } from "@nestjs/common";
import { runnerDiscoveryResponseSchema, type RunnerDiscoveryResponse } from "@radar/shared";
import {
  createObsReadClient,
  type ObsReadClient,
} from "../infrastructure/observability/create-obs-read-client";
import { ReadSideQueryService } from "../read-side/read-side-query.service";
import { WorkbookAdminService } from "../workbook-admin/workbook-admin.service";

export const OBS_READ_CLIENT = Symbol("OBS_READ_CLIENT");

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

/** Nest factory для ObsReadClient (embedded SQL vs obs-service HTTP). */
export function obsReadClientFactory(
  dataSource: Parameters<typeof createObsReadClient>[0],
): ObsReadClient {
  return createObsReadClient(dataSource);
}
