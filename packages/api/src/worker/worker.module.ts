import { Module } from "@nestjs/common";
import { WorkerStatusController } from "./worker-status.controller";
import { WorkerStatusService } from "./worker-status.service";

@Module({
  controllers: [WorkerStatusController],
  providers: [WorkerStatusService],
})
export class WorkerModule {}
