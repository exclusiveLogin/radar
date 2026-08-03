import { Controller, Get, Header } from "@nestjs/common";
import { apiPrometheusMetrics } from "./apiPrometheusMetrics";

@Controller("metrics")
export class MetricsController {
  /**
   * Отдаёт process/nodejs + доменные метрики API в формате Prometheus.
   */
  @Get()
  @Header("Content-Type", apiPrometheusMetrics.contentType)
  snapshot(): Promise<string> {
    return apiPrometheusMetrics.snapshot();
  }
}
