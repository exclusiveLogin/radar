import { Module } from "@nestjs/common";
import { ReadSideController } from "./read-side.controller";
import { ReadSideQueryService } from "./read-side-query.service";

@Module({
  providers: [ReadSideQueryService],
  controllers: [ReadSideController],
})
export class ReadSideModule {}
