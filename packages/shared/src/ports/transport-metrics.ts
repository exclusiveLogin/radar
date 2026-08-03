import type { RadarTopicRoutingKey } from "../transport/topicCatalog.js";

/** Исход обработки consumer-сообщения на уровне transport. */
export type TransportConsumeResult = "ack" | "nack" | "dedup_skip";

/**
 * Порт метрик RMQ/transport consumer.
 * Транспорт не зависит от prom-client — реализация в worker composition.
 */
export interface ITransportMetricsRecorder {
  onConsumed(
    routingKey: RadarTopicRoutingKey,
    result: TransportConsumeResult,
    durationMs: number,
  ): void;
}

/** No-op для тестов и publish-only клиентов (API). */
export const noopTransportMetricsRecorder: ITransportMetricsRecorder = {
  onConsumed() {},
};
