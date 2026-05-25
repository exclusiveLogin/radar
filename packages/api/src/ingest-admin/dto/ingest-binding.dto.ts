import { ApiProperty } from "@nestjs/swagger";
import { IngestProviderResponseDto } from "./ingest-provider.dto";

export class IngestBindingResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  providerId!: string;

  @ApiProperty({ format: "uuid", nullable: true })
  channelId!: string | null;

  @ApiProperty({ example: "tg:channel:main" })
  bindingKey!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ example: "@radar_channel" })
  externalTarget!: string;

  @ApiProperty({
    enum: [
      "user_mtproto_group",
      "user_mtproto_channel",
      "bot_api_group",
      "bot_api_dm",
      "hybrid_user_bot_group",
    ],
  })
  bindingMode!: string;

  @ApiProperty()
  parseOverrides!: Record<string, unknown>;

  @ApiProperty()
  adapterBinding!: Record<string, unknown>;
}

export class IngestProviderDetailResponseDto {
  @ApiProperty({ type: IngestProviderResponseDto })
  provider!: IngestProviderResponseDto;

  @ApiProperty({ type: [IngestBindingResponseDto] })
  bindings!: IngestBindingResponseDto[];
}

export class CreateIngestBindingBodyDto {
  @ApiProperty({ example: "main-channel" })
  bindingKey!: string;

  @ApiProperty({ required: false, example: "main" })
  channelKey?: string;

  @ApiProperty({ required: false, format: "uuid" })
  channelId?: string;

  @ApiProperty({ example: "@radar_channel" })
  externalTarget!: string;

  @ApiProperty({
    enum: [
      "user_mtproto_group",
      "user_mtproto_channel",
      "bot_api_group",
      "bot_api_dm",
      "hybrid_user_bot_group",
    ],
  })
  bindingMode!: string;

  @ApiProperty({ required: false, default: true })
  enabled?: boolean;

  @ApiProperty({ required: false })
  parseOverrides?: Record<string, unknown>;

  @ApiProperty({ required: false })
  adapterBinding?: Record<string, unknown>;
}

export class UpdateIngestBindingBodyDto {
  @ApiProperty({ description: "Включить или выключить привязку" })
  enabled!: boolean;
}
