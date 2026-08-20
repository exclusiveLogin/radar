import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { createObsPrometheusCollector } from "@radar/observability";
import type { ObsReadClient } from "../infrastructure/observability/create-obs-read-client";
import { OBS_READ_CLIENT } from "../observability-admin/observability-admin.service";
import { apiPrometheusMetrics } from "./apiPrometheusMetrics";

/**
 * Регистрирует obs → Prometheus мост на старте API.
 * Snapshot читается через существующий ObsReadClient (без второй записи в obs_*).
 */
@Injectable()
export class ObsPrometheusBridgeService implements OnModuleInit {
  constructor(@Inject(OBS_READ_CLIENT) private readonly obsRead: ObsReadClient) {}

  onModuleInit(): void {
    createObsPrometheusCollector(apiPrometheusMetrics.registry, () =>
      this.obsRead.fetchRuntimeSnapshot(),
    );
  }
}
