import { Module } from "@nestjs/common";
import { PipelineAdminController } from "./pipeline-admin.controller";
import { pipelineAdminDependenciesProvider } from "./pipeline-admin.providers";
import { PipelineAdminService } from "./pipeline-admin.service";

@Module({
  controllers: [PipelineAdminController],
  providers: [pipelineAdminDependenciesProvider, PipelineAdminService],
  exports: [PipelineAdminService],
})
export class PipelineAdminModule {}
