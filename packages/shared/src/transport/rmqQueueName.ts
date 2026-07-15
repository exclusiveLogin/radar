import type { RadarTopicRoutingKey } from "./topicCatalog.js";

/** Slug топика для имени очереди: `radar.message.parsed` → `radar_message_parsed`. */
export function rmqTopicSlug(routingKey: RadarTopicRoutingKey): string {
  return routingKey.replace(/\./g, "_");
}

/**
 * Имя durable-очереди consumer: fan-out per role + round-robin между репликами одной роли.
 * Пример: `radar_message_parsed.parse`, `radar_message_parsed.geo`.
 */
export function rmqQueueName(routingKey: RadarTopicRoutingKey, queueSuffix: string): string {
  return `${rmqTopicSlug(routingKey)}.${queueSuffix}`;
}

/** Суффикс очереди по pipelineKey launcher (Wave 6 bus-trigger). */
export const PIPELINE_RMQ_QUEUE_SUFFIX = {
  parse: "parse",
  "geo-enrich": "geo",
  tracking: "tracking",
} as const;

export type RmqConsumerRole =
  | "all"
  | "ingest"
  | "backfill"
  | "parse"
  | "geo"
  | "tracking"
  | "phase"
  | "api";

/** SSOT: RADAR_WORKER_ROLE / API → суффикс consumer-очереди. */
export function resolveRmqConsumerSuffix(role: RmqConsumerRole): string {
  if (role === "api") return "api";
  if (role === "all") return "monolith";
  if (role === "phase") return "parse";
  return role;
}

/** Суффикс wake-подписки по scope phase_definitions. */
export function resolveRmqQueueSuffixForPhaseScope(scope: string): string {
  return scope === "ingestParse" ? "parse" : "geo";
}
