import { Counter, Histogram, type Registry } from "prom-client";
import type {
  ITransportMetricsRecorder,
  RadarTopicRoutingKey,
  TransportConsumeResult,
} from "@radar/shared";

const TRANSPORT_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

/**
 * Prometheus-реализация ITransportMetricsRecorder для worker RMQ consumers.
 */
export function createPrometheusTransportMetricsRecorder(
  registry: Registry,
): ITransportMetricsRecorder {
  const messagesTotal = new Counter({
    name: "radar_transport_messages_total",
    help: "Исходы consume RMQ (ack/nack/dedup_skip)",
    labelNames: ["routing_key", "result"] as const,
    registers: [registry],
  });

  const messageDurationSeconds = new Histogram({
    name: "radar_transport_message_duration_seconds",
    help: "Длительность обработки consumer-сообщения (секунды)",
    labelNames: ["routing_key"] as const,
    buckets: [...TRANSPORT_DURATION_BUCKETS],
    registers: [registry],
  });

  return {
    onConsumed(
      routingKey: RadarTopicRoutingKey,
      result: TransportConsumeResult,
      durationMs: number,
    ): void {
      messagesTotal.inc({ routing_key: routingKey, result });
      if (result === "ack" || result === "nack") {
        messageDurationSeconds.observe({ routing_key: routingKey }, durationMs / 1000);
      }
    },
  };
}
