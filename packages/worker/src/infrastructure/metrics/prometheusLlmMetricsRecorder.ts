import { Counter, Histogram, type Registry } from "prom-client";
import type { LlmOpFailReason } from "../../domain/parse/geo/llmOpResult.js";
import { getWorkerPrometheusMetrics } from "./workerPrometheusMetrics.js";

/** Операции, которые ходят в LLM (enricher / validator). */
export type LlmMetricsOp = "llm" | "llm-validator";

/** Итог одного вызова: ok или fail-reason из LlmOpResult. */
export type LlmMetricsOutcome = "ok" | LlmOpFailReason;

/**
 * Порт записи LLM-метрик.
 * Инфраструктура: не тянет Prometheus в domain/application.
 */
export type ILlmMetricsRecorder = {
  record(op: LlmMetricsOp, outcome: LlmMetricsOutcome, durationMs: number): void;
  /** Счётчик вердиктов validator (confirm/reject) — только при ok. */
  recordVerdicts?(confirm: number, reject: number): void;
};

/** Buckets под CPU-LLM: от сотен мс до пары минут. */
const LLM_DURATION_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120] as const;

/**
 * Prometheus-реализация метрик LLM enricher / validator.
 */
export function createPrometheusLlmMetricsRecorder(registry: Registry): ILlmMetricsRecorder {
  const requestsTotal = new Counter({
    name: "radar_llm_requests_total",
    help: "Исходы вызовов LLM enricher / validator",
    labelNames: ["op", "outcome"] as const,
    registers: [registry],
  });

  const requestDurationSeconds = new Histogram({
    name: "radar_llm_request_duration_seconds",
    help: "Стенная длительность вызова LLM enricher / validator (секунды)",
    labelNames: ["op", "outcome"] as const,
    buckets: [...LLM_DURATION_BUCKETS],
    registers: [registry],
  });

  const verdictsTotal = new Counter({
    name: "radar_llm_validator_verdicts_total",
    help: "Вердикты llm-validator (confirm / reject)",
    labelNames: ["verdict"] as const,
    registers: [registry],
  });

  return {
    record(op, outcome, durationMs): void {
      requestsTotal.inc({ op, outcome });
      requestDurationSeconds.observe({ op, outcome }, durationMs / 1000);
    },
    recordVerdicts(confirm, reject): void {
      if (confirm > 0) verdictsTotal.inc({ verdict: "confirm" }, confirm);
      if (reject > 0) verdictsTotal.inc({ verdict: "reject" }, reject);
    },
  };
}

let singleton: ILlmMetricsRecorder | undefined;

/** Ленивый singleton на worker Prometheus registry (один процесс — один recorder). */
export function getLlmMetricsRecorder(): ILlmMetricsRecorder {
  singleton ??= createPrometheusLlmMetricsRecorder(getWorkerPrometheusMetrics().registry);
  return singleton;
}
