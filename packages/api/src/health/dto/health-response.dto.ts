import { ApiProperty } from "@nestjs/swagger";

export class HealthResponseDto {
  @ApiProperty({ example: "ok" })
  status!: string;

  @ApiProperty({ example: "2026-05-04T12:00:00.000Z" })
  timestamp!: string;

  @ApiProperty({ example: "0.0.1" })
  service!: string;
}
