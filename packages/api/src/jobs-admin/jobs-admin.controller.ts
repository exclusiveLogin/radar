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
import type { JobRunStatus, JobType } from "@radar/shared";
import { JobsAdminService } from "./jobs-admin.service";

/** Админ-API планировщика задач (ADR-003, Фаза G). */
@ApiTags("admin-jobs")
@Controller("admin/jobs")
export class JobsAdminController {
  constructor(private readonly jobs: JobsAdminService) {}

  @Get("definitions")
  @ApiOperation({ summary: "Список определений задач" })
  listDefinitions() {
    return this.jobs.listDefinitions();
  }

  @Post("definitions")
  @ApiOperation({ summary: "Создать определение задачи" })
  createDefinition(@Body() body: Record<string, unknown>) {
    return this.jobs.createDefinition(body);
  }

  @Patch("definitions/:id")
  @ApiOperation({ summary: "Обновить определение (cron/enabled/priority/params)" })
  updateDefinition(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.jobs.updateDefinition(id, body);
  }

  @Delete("definitions/:id")
  @ApiOperation({ summary: "Удалить определение" })
  removeDefinition(@Param("id") id: string) {
    return this.jobs.removeDefinition(id);
  }

  @Post("definitions/:id/trigger")
  @ApiOperation({ summary: "Запустить определение вручную (создать job_run)" })
  triggerDefinition(@Param("id") id: string) {
    return this.jobs.triggerDefinition(id);
  }

  @Get("runs")
  @ApiOperation({ summary: "История запусков задач" })
  listRuns(
    @Query("definitionId") definitionId?: string,
    @Query("type") type?: JobType,
    @Query("status") status?: JobRunStatus,
    @Query("limit") limit?: string,
  ) {
    return this.jobs.listRuns({
      definitionId,
      type,
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("runs/:id")
  @ApiOperation({ summary: "Карточка запуска" })
  getRun(@Param("id") id: string) {
    return this.jobs.getRun(id);
  }

  @Post("runs/:id/cancel")
  @ApiOperation({ summary: "Отменить запуск" })
  cancelRun(@Param("id") id: string) {
    return this.jobs.cancelRun(id);
  }
}
