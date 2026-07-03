import { Module } from "@nestjs/common";
import { PhasesAdminModule } from "../phases-admin/phases-admin.module";
import { TrackingAdminModule } from "../tracking-admin/tracking-admin.module";
import { WorkbookAdminController } from "./workbook-admin.controller";
import { WorkbookAdminService } from "./workbook-admin.service";

/** Read-side observability по Workbook Registry/Active Workloads/Run History — фасад над
 * TrackingAdminModule + PhasesAdminModule, без собственного доступа к БД. */
@Module({
  imports: [TrackingAdminModule, PhasesAdminModule],
  controllers: [WorkbookAdminController],
  providers: [WorkbookAdminService],
})
export class WorkbookAdminModule {}
