import { Controller, Get, Header } from "@nestjs/common";
import { createNodeRuntimeMetrics } from "@radar/observability";

const metrics = createNodeRuntimeMetrics({
  service: "api",
  role: "api",
});

@Controller("metrics")
export class MetricsController {
  /**
   * Отдаёт стандартные process/nodejs метрики API в формате Prometheus.
   */
  @Get()
  @Header("Content-Type", metrics.contentType)
  snapshot(): Promise<string> {
    return metrics.snapshot();
  }
}
