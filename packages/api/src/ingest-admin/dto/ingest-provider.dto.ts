import { ApiProperty } from "@nestjs/swagger";

export class IngestProviderResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "tg-main" })
  key!: string;

  @ApiProperty({ example: "Telegram main" })
  title!: string;

  @ApiProperty({ enum: ["telegram", "manual", "webhook", "rss"] })
  adapterKind!: string;

  @ApiProperty({ enum: ["draft", "active", "paused", "error"] })
  status!: string;

  @ApiProperty({ description: "Конфиг адаптера (discriminated union по kind)" })
  adapterConfig!: Record<string, unknown>;

  @ApiProperty({ description: "Ссылки на credential slots" })
  credentialRefs!: Record<string, unknown>;

  @ApiProperty({ nullable: true })
  lastError!: string | null;

  @ApiProperty({ nullable: true, example: "2026-05-25T12:00:00.000Z" })
  lastHeartbeatAt!: string | null;

  @ApiProperty({ example: "2026-05-25T12:00:00.000Z" })
  createdAt!: string;

  @ApiProperty({ example: "2026-05-25T12:00:00.000Z" })
  updatedAt!: string;
}

export class CreateIngestProviderBodyDto {
  @ApiProperty({ example: "tg-user-1" })
  key!: string;

  @ApiProperty({ example: "Telegram user MTProto" })
  title!: string;

  @ApiProperty({ enum: ["telegram", "manual", "webhook", "rss"] })
  adapterKind!: string;

  @ApiProperty({ description: "adapterConfig с полем kind" })
  adapterConfig!: Record<string, unknown>;

  @ApiProperty({ required: false })
  credentialRefs?: Record<string, unknown>;
}

export class UpdateIngestProviderBodyDto {
  @ApiProperty({ required: false })
  title?: string;

  @ApiProperty({ enum: ["draft", "active", "paused", "error"], required: false })
  status?: string;

  @ApiProperty({ required: false })
  adapterConfig?: Record<string, unknown>;

  @ApiProperty({ required: false })
  credentialRefs?: Record<string, unknown>;
}
