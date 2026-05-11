import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InjectDataSource } from "@nestjs/typeorm";
import { healthResponseSchema, readyResponseSchema } from "@radar/shared";
import { DataSource } from "typeorm";
import { HealthResponseDto } from "./dto/health-response.dto";
import { ReadyResponseDto } from "./dto/ready-response.dto";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}@Get("health")
  @ApiOperation({ summary: "Liveness без обращения к БД" })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return healthResponseSchema.parse({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
      service: "radar-api",
    });
  }@Get("ready")
  @ApiOperation({ summary: "Readiness: SELECT 1 к PostgreSQL" })
  @ApiOkResponse({ type: ReadyResponseDto })
  async ready(): Promise<ReadyResponseDto> {
    try {
      await this.dataSource.query("SELECT 1");
      return readyResponseSchema.parse({
        status: "ready" as const,
        database: true as const,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException({
        status: "not_ready",
        database: false,
        message,
      });
    }
  }
}
