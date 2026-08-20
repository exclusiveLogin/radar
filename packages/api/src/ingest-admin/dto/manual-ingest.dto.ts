import { ApiProperty } from "@nestjs/swagger";

export class ManualIngestBodyDto {
  @ApiProperty({ required: false, example: "alerts-main" })
  channelKey?: string;

  @ApiProperty({ required: false, format: "uuid" })
  bindingId?: string;

  @ApiProperty({ example: "Удар по объекту X в районе Y" })
  rawText!: string;

  @ApiProperty({ required: false, example: "2026-05-25T12:00:00.000Z" })
  postedAt?: string;

  @ApiProperty({ required: false })
  meta?: Record<string, unknown>;
}

export class ManualIngestResponseDto {
  @ApiProperty({ format: "uuid" })
  rawMessageId!: string;

  @ApiProperty({ description: "true если сообщение новое, не дубликат по hash/identity" })
  inserted!: boolean;

  @ApiProperty({ description: "true если RawMessageIngested опубликован в RMQ для parse pipeline" })
  parseScheduled!: boolean;
}
