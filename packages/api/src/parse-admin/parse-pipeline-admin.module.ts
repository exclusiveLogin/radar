import { Module } from "@nestjs/common";
import { PhasesAdminModule } from "../phases-admin/phases-admin.module";
import { TrackingAdminModule } from "../tracking-admin/tracking-admin.module";
import { ParsePipelineAdminController } from "./parse-pipeline-admin.controller";
import { ParsePipelineAdminService } from "./parse-pipeline-admin.service";

@Module({
  imports: [PhasesAdminModule, TrackingAdminModule],
  controllers: [ParsePipelineAdminController],
  providers: [ParsePipelineAdminService],
  exports: [ParsePipelineAdminService],
})
export class ParsePipelineAdminModule {}
