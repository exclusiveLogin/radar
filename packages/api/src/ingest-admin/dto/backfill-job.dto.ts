import { ApiProperty } from "@nestjs/swagger";

export class CreateBackfillJobBodyDto {
  @ApiProperty({ format: "uuid" })
  bindingId!: string;

  @ApiProperty({
    enum: ["by_date_range", "by_external_id_range", "full_history"],
  })
  strategy!: string;

  @ApiProperty({
    required: false,
    description: "fromPostedAt, toPostedAt, batchSize и др.",
  })
  params?: Record<string, unknown>;
}

export class BackfillJobResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  bindingId!: string;

  @ApiProperty({ format: "uuid" })
  providerId!: string;

  @ApiProperty({
    enum: ["by_date_range", "by_external_id_range", "full_history"],
  })
  strategy!: string;

  @ApiProperty()
  params!: Record<string, unknown>;

  @ApiProperty({ enum: ["pending", "running", "completed", "failed"] })
  status!: string;

  @ApiProperty()
  stats!: { inserted: number; duplicates: number; parsed: number };

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
