import { Module } from "@nestjs/common";
import { TrackingAdminController } from "./tracking-admin.controller";
import { TrackingAdminService } from "./tracking-admin.service";

@Module({
  controllers: [TrackingAdminController],
  providers: [TrackingAdminService],
  exports: [TrackingAdminService],
})
export class TrackingAdminModule {}
