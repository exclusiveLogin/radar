import { Module } from "@nestjs/common";
import { WorkerModule } from "../worker/worker.module";
import { AdminController } from "./admin.controller";
import { AdminGateway } from "./admin.gateway";
import { AdminTelemetryService } from "./admin-telemetry.service";

/**
 * Админ-наблюдаемость: телеметрия процессов (REST) и realtime-шлюз `/ws/admin`
 * (worker-status, parse-log, backfill-progress). Backfill/каналы/статистика
 * живут в IngestAdminModule и ReadSideModule.
 */
@Module({
  imports: [WorkerModule],
  controllers: [AdminController],
  providers: [AdminTelemetryService, AdminGateway],
})
export class AdminModule {}
