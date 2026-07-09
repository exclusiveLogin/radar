import { Module } from "@nestjs/common";
import { PhasesAdminModule } from "../phases-admin/phases-admin.module";
import { ParsePipelineAdminModule } from "../parse-admin/parse-pipeline-admin.module";
import { TrackingAdminModule } from "../tracking-admin/tracking-admin.module";
import { ObservabilityAdminModule } from "../observability-admin/observability-admin.module";
import { WorkerModule } from "../worker/worker.module";
import { AdminController } from "./admin.controller";
import { AdminGateway } from "./admin.gateway";
import { AdminTelemetryService } from "./admin-telemetry.service";

/**
 * Админ-наблюдаемость: телеметрия процессов (REST) и realtime-шлюз `/ws/admin`
 * (worker-status, parse-log, backfill-progress, phases-update). Backfill/каналы/статистика
 * живут в IngestAdminModule и ReadSideModule.
 */
@Module({
  imports: [WorkerModule, PhasesAdminModule, ParsePipelineAdminModule, TrackingAdminModule, ObservabilityAdminModule],
  controllers: [AdminController],
  providers: [AdminTelemetryService, AdminGateway],
})
export class AdminModule {}
