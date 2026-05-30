import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { WorkerStatusService } from "./worker-status.service";

@ApiTags("worker")
@Controller("worker")
export class WorkerStatusController {
  constructor(private readonly workerStatus: WorkerStatusService) {}

  @Get("status")
  @ApiOperation({ summary: "Статус worker: HTTP probe + подсказки из БД" })
  @ApiOkResponse({ description: "WorkerStatusResponse" })
  async status() {
    return this.workerStatus.getStatus();
  }
}
