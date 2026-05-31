import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminTelemetryService } from "./admin-telemetry.service";

@ApiTags("admin")
@Controller("admin")
export class AdminController {
  constructor(private readonly telemetry: AdminTelemetryService) {}

  @Get("telemetry")
  @ApiOperation({ summary: "Телеметрия процессов API и worker (heap/cpu/uptime)" })
  @ApiOkResponse({ description: "AdminTelemetry" })
  getTelemetry() {
    return this.telemetry.getTelemetry();
  }
}
