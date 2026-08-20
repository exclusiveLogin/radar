import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ControlTrackingRunUseCase,
  PatchTrackingConfigUseCase,
  SetTrackingEnabledUseCase,
  StartTrackingRebuildUseCase,
  TrackingAdminCommandError,
} from "../application/tracking-admin/tracking-admin-commands";
import { TrackingAdminQueryService } from "./tracking-admin.service";

@ApiTags("admin-tracking")
@Controller("admin/tracking")
export class TrackingAdminController {
  constructor(
    private readonly queries: TrackingAdminQueryService,
    private readonly patchConfigCommand: PatchTrackingConfigUseCase,
    private readonly setEnabledCommand: SetTrackingEnabledUseCase,
    private readonly rebuildCommand: StartTrackingRebuildUseCase,
    private readonly controlRunCommand: ControlTrackingRunUseCase,
  ) {}

  @Get("status")
  @ApiOperation({ summary: "Статус пайплайна треков" })
  getStatus() {
    return this.queries.getStatus();
  }

  @Get("runs")
  @ApiOperation({ summary: "История rebuild runs" })
  listRuns(@Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : 20;
    return this.queries.listRuns(Number.isFinite(parsed) ? parsed : 20);
  }

  @Get("config")
  getConfig() {
    return this.queries.readConfig();
  }

  @Patch("config")
  patchConfig(@Body() body: Record<string, unknown>) {
    return this.execute(() => this.patchConfigCommand.execute(body));
  }

  @Patch("enabled")
  patchEnabled(@Body() body: { enabled: boolean }) {
    return this.execute(() => this.setEnabledCommand.execute(body.enabled === true));
  }

  @Post("rebuild")
  rebuild() {
    return this.execute(() => this.rebuildCommand.execute());
  }

  @Post("pause")
  pause() {
    return this.execute(() => this.controlRunCommand.execute("pause"));
  }

  @Post("resume")
  resume() {
    return this.execute(() => this.controlRunCommand.execute("resume"));
  }

  @Post("cancel")
  cancel() {
    return this.execute(() => this.controlRunCommand.execute("cancel"));
  }

  /** Преобразует ожидаемые ошибки use-case в прежний HTTP-контракт. */
  private async execute<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      if (error instanceof TrackingAdminCommandError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
