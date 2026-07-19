import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ChannelEntity,
  IngestBackfillJobEntity,
  IngestBindingEntity,
  IngestProviderEntity,
  RawMessageEntity,
} from "@radar/persistence";
import { IngestAdminController } from "./ingest-admin.controller";
import { ingestAdminDependenciesProvider } from "./ingest-admin.providers";
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
  providers: [ingestAdminDependenciesProvider, IngestAdminService],
})
export class IngestAdminModule {}
