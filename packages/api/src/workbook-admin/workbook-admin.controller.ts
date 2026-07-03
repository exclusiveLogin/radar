import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { WorkbookAdminService } from "./workbook-admin.service";

@ApiTags("admin-workbook")
@Controller("admin/workbook")
export class WorkbookAdminController {
  constructor(private readonly workbook: WorkbookAdminService) {}

  @Get("observability")
  @ApiOperation({
    summary: "Workbook Registry / Active Workloads / Run History по pipelineKey (tracking/parse/geo-enrich)",
  })
  getObservability() {
    return this.workbook.getObservability();
  }
}
