import { Module } from "@nestjs/common";
import { PhasesAdminController } from "./phases-admin.controller";
import { PhasesAdminService } from "./phases-admin.service";

@Module({
  controllers: [PhasesAdminController],
  providers: [PhasesAdminService],
})
export class PhasesAdminModule {}
