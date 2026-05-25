import { ApiProperty } from "@nestjs/swagger";

export class RawMessageItemDto {
  @ApiProperty({ format: "uuid", required: false })
  id?: string;

  @ApiProperty({ example: "alerts-main" })
  channelKey!: string;

  @ApiProperty({ example: "manual-admin" })
  providerKey!: string;

  @ApiProperty({ enum: ["telegram", "manual", "webhook", "rss"] })
  sourceKind!: string;

  @ApiProperty()
  externalMessageId!: string;

  @ApiProperty({ nullable: true, required: false })
  revisionKey?: string | null;

  @ApiProperty({ nullable: true, required: false })
  sourceSequence?: string | null;

  @ApiProperty({ example: "2026-05-25T12:00:00.000Z" })
  postedAt!: string;

  @ApiProperty({ enum: ["live", "backfill", "manual"] })
  ingestMode!: string;

  @ApiProperty()
  rawText!: string;

  @ApiProperty({ required: false })
  rawPayload?: Record<string, unknown>;

  @ApiProperty()
  hash!: string;

  @ApiProperty({ required: false })
  fetchedAt?: string;
}

export class TimelineAnchorDto {
  @ApiProperty()
  channelKey!: string;

  @ApiProperty({ example: "2026-05-25T12:00:00.000Z" })
  postedAtUtc!: string;

  @ApiProperty({ description: "sourceSequence или externalMessageId" })
  tieBreaker!: string;

  @ApiProperty({ enum: ["before", "after"] })
  direction!: "before" | "after";

  @ApiProperty({ maximum: 200 })
  limit!: number;
}

export class TimelineResponseDto {
  @ApiProperty({ type: [RawMessageItemDto] })
  items!: RawMessageItemDto[];

  @ApiProperty({ type: TimelineAnchorDto, nullable: true })
  nextAnchor!: TimelineAnchorDto | null;
}
