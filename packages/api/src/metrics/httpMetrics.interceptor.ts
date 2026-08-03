import { Counter, Histogram } from "prom-client";
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { apiPrometheusMetrics } from "./apiPrometheusMetrics";

const HTTP_DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

const httpRequestsTotal = new Counter({
  name: "radar_http_requests_total",
  help: "HTTP-запросы API (method/route/status)",
  labelNames: ["method", "route", "status"] as const,
  registers: [apiPrometheusMetrics.registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: "radar_http_request_duration_seconds",
  help: "Длительность HTTP-запросов API (секунды)",
  labelNames: ["method", "route", "status"] as const,
  buckets: [...HTTP_DURATION_BUCKETS],
  registers: [apiPrometheusMetrics.registry],
});

/**
 * RED-метрики HTTP: Counter + Histogram по route template (не raw URL — без кардинальности id).
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string; route?: { path?: string }; path?: string }>();
    const res = http.getResponse<{ statusCode?: number }>();
    const method = req.method ?? "UNKNOWN";
    const route = resolveRouteTemplate(req);
    const started = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const status = String(res.statusCode ?? 0);
        const elapsedSec = Number(process.hrtime.bigint() - started) / 1e9;
        httpRequestsTotal.inc({ method, route, status });
        httpRequestDurationSeconds.observe({ method, route, status }, elapsedSec);
      }),
    );
  }
}

function resolveRouteTemplate(req: {
  route?: { path?: string };
  path?: string;
}): string {
  const template = req.route?.path?.trim();
  if (template) return template;
  const path = req.path?.trim();
  return path && path.length > 0 ? path : "unknown";
}
