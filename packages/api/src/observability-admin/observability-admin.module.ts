import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ReadSideModule } from "../read-side/read-side.module";
import { WorkbookAdminModule } from "../workbook-admin/workbook-admin.module";
import { ObservabilityAdminController } from "./observability-admin.controller";
import {
  OBS_READ_CLIENT,
  ObservabilityAdminService,
  obsReadClientFactory,
} from "./observability-admin.service";

/** Admin Runner Observability: merged discovery read-side. */
@Module({
  imports: [WorkbookAdminModule, ReadSideModule],
  controllers: [ObservabilityAdminController],
  providers: [
    ObservabilityAdminService,
    {
      provide: OBS_READ_CLIENT,
      useFactory: (dataSource: DataSource) => obsReadClientFactory(dataSource),
      inject: [DataSource],
    },
  ],
  exports: [ObservabilityAdminService],
})
export class ObservabilityAdminModule {}
