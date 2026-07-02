import { Body, Controller, Get, Patch, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { TrackingAdminService } from "./tracking-admin.service";

@ApiTags("admin-tracking")
@Controller("admin/tracking")
export class TrackingAdminController {
  constructor(private readonly tracking: TrackingAdminService) {}

  @Get("status")
  @ApiOperation({ summary: "Статус пайплайна треков" })
  getStatus() {
    return this.tracking.getStatus();
  }

  @Get("runs")
  @ApiOperation({ summary: "История rebuild runs" })
  listRuns(@Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : 20;
    return this.tracking.listRuns(Number.isFinite(parsed) ? parsed : 20);
  }

  @Get("config")
  getConfig() {
    return this.tracking.getConfig();
  }

  @Patch("config")
  patchConfig(@Body() body: Record<string, unknown>) {
    return this.tracking.patchConfig(body);
  }

  @Patch("enabled")
  patchEnabled(@Body() body: { enabled: boolean }) {
    return this.tracking.patchEnabled(body.enabled === true);
  }

  @Post("rebuild")
  rebuild() {
    return this.tracking.rebuild();
  }

  @Post("soft-rebuild")
  @ApiOperation({ summary: "Пересборка треков с текущим config (без сброса весов)" })
  softRebuild() {
    return this.tracking.softRebuild();
  }

  @Post("reset")
  reset() {
    return this.tracking.reset();
  }

  @Post("pause")
  pause() {
    return this.tracking.pause();
  }

  @Post("resume")
  resume() {
    return this.tracking.resume();
  }

  @Post("cancel")
  cancel() {
    return this.tracking.cancel();
  }
}
