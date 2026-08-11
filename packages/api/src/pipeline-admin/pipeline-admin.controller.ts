import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PipelineAdminService } from "./pipeline-admin.service";

@ApiTags("admin-pipeline")
@Controller("admin/pipeline")
export class PipelineAdminController {
  constructor(private readonly pipeline: PipelineAdminService) {}

  @Get("topology")
  @ApiOperation({ summary: "Граф шагов pipeline.manifest + очереди / last step run" })
  topology() {
    return this.pipeline.getTopology();
  }

  @Post("steps/:id/run")
  @ApiOperation({ summary: "Запрос StepRunRequested (RMQ)" })
  runStep(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.pipeline.requestStepRun(id, body);
  }

  @Post("steps/:id/reset")
  @ApiOperation({
    summary: "Reset шага: dryRun=preview в API; apply → StepResetRequested",
  })
  resetStep(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.pipeline.requestStepReset(id, body);
  }
}
