import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JobDefinitionEntity, JobRunEntity } from "../jobs/entities";
import { JobsAdminController } from "./jobs-admin.controller";
import { JobsAdminService } from "./jobs-admin.service";

@Module({
  imports: [TypeOrmModule.forFeature([JobDefinitionEntity, JobRunEntity])],
  controllers: [JobsAdminController],
  providers: [JobsAdminService],
})
export class JobsAdminModule {}
