import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PhasesAdminService } from "./phases-admin.service";

@ApiTags("admin-phases")
@Controller("admin/phases")
export class PhasesAdminController {
  constructor(private readonly phases: PhasesAdminService) {}

  @Get()
  @ApiOperation({ summary: "Список фаз" })
  listPhases() {
    return this.phases.listPhases();
  }

  @Get("runs/overview")
  @ApiOperation({ summary: "Сводка активных runs и coverage по фазам" })
  runsOverview() {
    return this.phases.runsOverview();
  }

  @Get("runs")
  @ApiOperation({ summary: "История запусков фаз" })
  listRuns(
    @Query("phaseId") phaseId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.phases.listRuns({
      phaseId,
      status,
      limit: parsedLimit && !Number.isNaN(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get("runs/:id")
  @ApiOperation({ summary: "Карточка run (stats + log tail)" })
  getRun(@Param("id") id: string) {
    return this.phases.getRun(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Обновить фазу (enabled, policy, enrichers)" })
  patchPhase(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.phases.patchPhase(id, body);
  }

  @Post(":id/run")
  @ApiOperation({ summary: "Ручной запуск фазы (manual)" })
  startRun(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.phases.startRun(id, body);
  }

  @Post(":id/clear-queue")
  @ApiOperation({
    summary: "Удалить pending/processing очередь фазы (geo jobs / phase_coverage) + cancel runs",
  })
  clearPhaseQueue(@Param("id") id: string) {
    return this.phases.clearPhaseQueue(id);
  }

  @Post("runs/stop-all")
  @ApiOperation({ summary: "Отменить все активные runs (running/paused/pending)" })
  stopAllRuns() {
    return this.phases.stopAllActiveRuns();
  }

  @Post("runs/:id/cancel")
  cancelRun(@Param("id") id: string) {
    return this.phases.cancelRun(id);
  }

  @Post("runs/:id/pause")
  pauseRun(@Param("id") id: string) {
    return this.phases.pauseRun(id);
  }

  @Post("runs/:id/resume")
  resumeRun(@Param("id") id: string) {
    return this.phases.resumeRun(id);
  }

  @Delete("runs/:id")
  @ApiOperation({ summary: "Force stop run + сброс processing coverage" })
  forceStop(@Param("id") id: string) {
    return this.phases.forceStopRun(id);
  }

  @Post("replay")
  @ApiOperation({ summary: "Invalidate coverage и catch-up по фазам" })
  replay(@Body() body: Record<string, unknown>) {
    return this.phases.replay(body);
  }
}
