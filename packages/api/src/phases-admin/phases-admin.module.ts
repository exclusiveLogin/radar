import { Module, forwardRef } from "@nestjs/common";
import { MapModule } from "../map/map.module";
import { PhasesAdminController } from "./phases-admin.controller";
import { PhasesAdminService } from "./phases-admin.service";

@Module({
  imports: [forwardRef(() => MapModule)],
  controllers: [PhasesAdminController],
  providers: [PhasesAdminService],
  exports: [PhasesAdminService],
})
export class PhasesAdminModule {}
