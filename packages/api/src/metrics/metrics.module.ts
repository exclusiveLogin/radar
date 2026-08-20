import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ObservabilityAdminModule } from "../observability-admin/observability-admin.module";
import { HttpMetricsInterceptor } from "./httpMetrics.interceptor";
import { MetricsController } from "./metrics.controller";
import { ObsPrometheusBridgeService } from "./obsPrometheusBridge.service";

@Module({
  imports: [ObservabilityAdminModule],
  controllers: [MetricsController],
  providers: [
    ObsPrometheusBridgeService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
})
export class MetricsModule {}
