import { Module } from "@nestjs/common";
import { TrackingInfraModule } from "../tracking/tracking-infra.module";
import { TrackingAdminController } from "./tracking-admin.controller";
import { TrackingAdminService } from "./tracking-admin.service";

@Module({
  imports: [TrackingInfraModule],
  controllers: [TrackingAdminController],
  providers: [TrackingAdminService],
  exports: [TrackingAdminService],
})
export class TrackingAdminModule {}
