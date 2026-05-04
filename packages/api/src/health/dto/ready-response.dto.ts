import { ApiProperty } from "@nestjs/swagger";

export class ReadyResponseDto {
  @ApiProperty({ example: "ready" })
  status!: string;

  @ApiProperty({ example: true })
  database!: boolean;
}
