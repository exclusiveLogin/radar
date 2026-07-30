import { Controller, Get, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ParsePipelineAdminService } from "./parse-pipeline-admin.service";

@ApiTags("admin-parse")
@Controller("admin/parse")
export class ParsePipelineAdminController {
  constructor(private readonly parsePipeline: ParsePipelineAdminService) {}

  @Get("status")
  @ApiOperation({ summary: "Статус reset/catch-up (прогресс фоновой CLI)" })
  getStatus() {
    return this.parsePipeline.getStatus();
  }

  @Post("reset")
  @ApiOperation({ summary: "Операционный сброс parsed (pipeline reset)" })
  reset() {
    return this.parsePipeline.startReset();
  }

  @Post("catch-up")
  @ApiOperation({ summary: "Поставить отсутствующие raw в очередь и разобрать батчами" })
  catchUp() {
    return this.parsePipeline.startCatchUp();
  }
}
