import { Controller, Get, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ParsePipelineAdminService } from "./parse-pipeline-admin.service";

@ApiTags("admin-parse")
@Controller("admin/parse")
export class ParsePipelineAdminController {
  constructor(private readonly parsePipeline: ParsePipelineAdminService) {}

  @Get("status")
  @ApiOperation({ summary: "Статус parse rebuild (wipe CLI + очередь catch-up)" })
  getStatus() {
    return this.parsePipeline.getStatus();
  }

  @Post("rebuild")
  @ApiOperation({
    summary: "Parse rebuild: stop → wipe parsed → enqueue catch-up",
  })
  rebuild() {
    return this.parsePipeline.startRebuild();
  }
}
