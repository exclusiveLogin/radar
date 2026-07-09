import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ObservabilityAdminService } from "./observability-admin.service";

@ApiTags("admin-runner")
@Controller("admin/runner")
export class ObservabilityAdminController {
  constructor(private readonly observability: ObservabilityAdminService) {}

  @Get("discovery")
  @ApiOperation({
    summary: "Runner Platform discovery: obs runtime + workbook + stats (5×3 grid source)",
  })
  getDiscovery() {
    return this.observability.getDiscovery();
  }
}
