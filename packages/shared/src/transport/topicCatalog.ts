/**
 * SSOT routing keys RMQ / in-process transport.
 */
import { z } from "zod";
import type { DomainEventType } from "../schemas/events/domain-event.js";

export const RADAR_TOPICS = {
  RAW_INGESTED: "radar.raw.ingested",
  MESSAGE_PARSED: "radar.message.parsed",
  GEO_ENRICH_REQUEST: "radar.geo.enrich.request",
  RUNNER_DRAIN_PARSE: "radar.runner.drain.parse",
  RUNNER_DRAIN_GEO: "radar.runner.drain.geo",
  RUNNER_CONTROL: "radar.runner.control",
} as const;

export type RadarTopicRoutingKey = (typeof RADAR_TOPICS)[keyof typeof RADAR_TOPICS];

const topicValues = Object.values(RADAR_TOPICS) as [RadarTopicRoutingKey, ...RadarTopicRoutingKey[]];

export const radarTopicRoutingKeySchema = z.enum(topicValues);

const EVENT_TYPE_TO_TOPIC: Partial<Record<DomainEventType, RadarTopicRoutingKey>> = {
  RawMessageIngested: RADAR_TOPICS.RAW_INGESTED,
  MessageParsed: RADAR_TOPICS.MESSAGE_PARSED,
  MessageParseFailed: RADAR_TOPICS.MESSAGE_PARSED,
};

export function defaultTopicForEvent(type: DomainEventType): RadarTopicRoutingKey | null {
  return EVENT_TYPE_TO_TOPIC[type] ?? null;
}

export function drainTopicForPhaseScope(scope: "ingestParse" | "geoParse"): RadarTopicRoutingKey {
  return scope === "geoParse" ? RADAR_TOPICS.RUNNER_DRAIN_GEO : RADAR_TOPICS.RUNNER_DRAIN_PARSE;
}

/** producer-side ensureTopology */
export function listRadarTopicRoutingKeys(): readonly RadarTopicRoutingKey[] {
  return topicValues;
}
