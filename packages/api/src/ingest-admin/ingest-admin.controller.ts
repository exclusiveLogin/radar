import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { IngestAdminService } from "./ingest-admin.service";
import {
  BackfillJobResponseDto,
  CreateBackfillJobBodyDto,
  CreateIngestBindingBodyDto,
  CreateIngestProviderBodyDto,
  IngestBindingResponseDto,
  IngestProviderDetailResponseDto,
  IngestProviderResponseDto,
  ManualIngestBodyDto,
  ManualIngestResponseDto,
  TimelineResponseDto,
  UpdateIngestBindingBodyDto,
  UpdateIngestProviderBodyDto,
} from "./dto";

@ApiTags("admin-ingest")
@Controller("admin/ingest")
export class IngestAdminController {
  constructor(private readonly ingestAdmin: IngestAdminService) {}

  @Get("providers")
  @ApiOperation({ summary: "Список ingest-провайдеров" })
  @ApiOkResponse({ type: IngestProviderResponseDto, isArray: true })
  listProviders(): Promise<IngestProviderResponseDto[]> {
    return this.ingestAdmin.listProviders();
  }

  @Get("providers/:id")
  @ApiOperation({ summary: "Провайдер и его bindings" })
  @ApiOkResponse({ type: IngestProviderDetailResponseDto })
  getProvider(@Param("id") id: string): Promise<IngestProviderDetailResponseDto> {
    return this.ingestAdmin.getProvider(id);
  }

  @Post("providers")
  @ApiOperation({ summary: "Создать ingest-провайдер" })
  @ApiCreatedResponse({ type: IngestProviderResponseDto })
  createProvider(@Body() body: CreateIngestProviderBodyDto): Promise<IngestProviderResponseDto> {
    return this.ingestAdmin.createProvider(body);
  }

  @Patch("providers/:id")
  @ApiOperation({ summary: "Обновить провайдер" })
  @ApiOkResponse({ type: IngestProviderResponseDto })
  updateProvider(
    @Param("id") id: string,
    @Body() body: UpdateIngestProviderBodyDto,
  ): Promise<IngestProviderResponseDto> {
    return this.ingestAdmin.updateProvider(id, body);
  }

  @Post("providers/:id/bindings")
  @ApiOperation({ summary: "Добавить binding к провайдеру" })
  @ApiCreatedResponse({ type: IngestBindingResponseDto })
  createBinding(
    @Param("id") providerId: string,
    @Body() body: CreateIngestBindingBodyDto,
  ): Promise<IngestBindingResponseDto> {
    return this.ingestAdmin.createBinding(providerId, body);
  }

  @Patch("bindings/:id")
  @ApiOperation({ summary: "Включить/выключить binding" })
  @ApiOkResponse({ type: IngestBindingResponseDto })
  updateBinding(
    @Param("id") id: string,
    @Body() body: UpdateIngestBindingBodyDto,
  ): Promise<IngestBindingResponseDto> {
    return this.ingestAdmin.updateBinding(id, body);
  }

  @Post("providers/:id/start")
  @ApiOperation({ summary: "Запустить дежурство (status=active)" })
  @ApiOkResponse({ type: IngestProviderResponseDto })
  startProvider(@Param("id") id: string): Promise<IngestProviderResponseDto> {
    return this.ingestAdmin.startProvider(id);
  }

  @Post("providers/:id/stop")
  @ApiOperation({ summary: "Остановить дежурство (status=paused)" })
  @ApiOkResponse({ type: IngestProviderResponseDto })
  stopProvider(@Param("id") id: string): Promise<IngestProviderResponseDto> {
    return this.ingestAdmin.stopProvider(id);
  }

  @Post("messages")
  @ApiOperation({ summary: "Ручной ingest сообщения об атаке" })
  @ApiCreatedResponse({ type: ManualIngestResponseDto })
  manualIngest(@Body() body: ManualIngestBodyDto): Promise<ManualIngestResponseDto> {
    return this.ingestAdmin.manualIngest(body);
  }

  @Get("messages")
  @ApiOperation({ summary: "Timeline raw_messages с anchor-пагинацией" })
  @ApiOkResponse({ type: TimelineResponseDto })
  listMessages(@Query() query: Record<string, unknown>): Promise<TimelineResponseDto> {
    return this.ingestAdmin.listMessages(query);
  }

  @Post("backfill-jobs")
  @ApiOperation({ summary: "Создать задачу backfill по binding" })
  @ApiCreatedResponse({ type: BackfillJobResponseDto })
  createBackfillJob(@Body() body: CreateBackfillJobBodyDto): Promise<BackfillJobResponseDto> {
    return this.ingestAdmin.createBackfillJob(body);
  }
}
