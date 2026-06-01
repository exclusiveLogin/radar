import { Module } from "@nestjs/common";
import { MapModule } from "../map/map.module";
import { PhasesAdminController } from "./phases-admin.controller";
import { PhasesAdminService } from "./phases-admin.service";

@Module({
  imports: [MapModule],
  controllers: [PhasesAdminController],
  providers: [PhasesAdminService],
})
export class PhasesAdminModule {}
