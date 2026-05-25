import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChannelEntity,
  IngestBackfillJobEntity,
  IngestBindingEntity,
  IngestProviderEntity,
  RawMessageEntity,
} from "../ingest/entities";
import { IngestAdminController } from "./ingest-admin.controller";
import { IngestAdminService } from "./ingest-admin.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IngestProviderEntity,
      IngestBindingEntity,
      ChannelEntity,
      RawMessageEntity,
      IngestBackfillJobEntity,
    ]),
  ],
  controllers: [IngestAdminController],
  providers: [IngestAdminService],
})
export class IngestAdminModule {}
