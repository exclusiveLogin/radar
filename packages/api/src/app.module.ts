import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as path from "path";
import { AdminModule } from "./admin/admin.module";
import { HealthModule } from "./health/health.module";
import { IngestAdminModule } from "./ingest-admin/ingest-admin.module";
import { MapModule } from "./map/map.module";
import { ReadSideModule } from "./read-side/read-side.module";
import { WorkerModule } from "./worker/worker.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), "../../.env"),
        path.join(process.cwd(), ".env"),
      ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("DATABASE_URL"),
        autoLoadEntities: true,
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    AdminModule,
    HealthModule,
    IngestAdminModule,
    MapModule,
    ReadSideModule,
    WorkerModule,
  ],
})
export class AppModule {}
