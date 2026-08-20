import { Module, forwardRef } from "@nestjs/common";
import { MapModule } from "../map/map.module";
import { PhasesAdminController } from "./phases-admin.controller";
import { phasesAdminDependenciesProvider } from "./phases-admin.providers";
import { PhasesAdminService } from "./phases-admin.service";

@Module({
  imports: [forwardRef(() => MapModule)],
  controllers: [PhasesAdminController],
  providers: [phasesAdminDependenciesProvider, PhasesAdminService],
  exports: [PhasesAdminService],
})
export class PhasesAdminModule {}
