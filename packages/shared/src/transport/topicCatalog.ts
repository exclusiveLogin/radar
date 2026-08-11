/**
 * SSOT routing keys RMQ / in-process transport.
 * Ключи открыты: каталог собирается из pipeline.manifest + системные константы.
 */
import type { PipelineManifest } from "../pipeline/pipelineManifest.schema.js";
import { radarRoutingKeySchema } from "./radarRoutingKey.js";

/** Известные системные / доменные ключи (не закрытый enum для publish/subscribe). */
export const RADAR_TOPICS = {
  RAW_INGESTED: "radar.raw.ingested",
  MESSAGE_PARSED: "radar.message.parsed",
  GEO_ENRICH_REQUEST: "radar.geo.enrich.request",
  RUNNER_DRAIN_PARSE: "radar.runner.drain.parse",
  RUNNER_DRAIN_GEO: "radar.runner.drain.geo",
  RUNNER_DRAIN_TRACKING: "radar.runner.drain.tracking",
  RUNNER_CONTROL: "radar.runner.control",
  /** Parse drain → tracking (DSL: parse.emits ∩ tracking.trigger.on). */
  PARSE_STABILIZED: "radar.parse.stabilized",
  /** Зарезервирован: geo drain без downstream (не в tracking.trigger). */
  GEO_STABILIZED: "radar.geo.stabilized",
  CHANNEL_BACKFILL_COMPLETED: "radar.channel.backfill.completed",
  STEP_RUN_REQUESTED: "radar.step.run.requested",
  STEP_RESET_REQUESTED: "radar.step.reset.requested",
  STEP_STARTED: "radar.step.started",
  STEP_DRAINED: "radar.step.drained",
  STEP_FAILED: "radar.step.failed",
  SYSTEM_INIT: "radar.system.init",
  SYSTEM_DRAIN: "radar.system.drain",
} as const;

export type RadarTopicRoutingKey = string;

export const radarTopicRoutingKeySchema = radarRoutingKeySchema;

/** Системные ключи + известные доменные — минимум для ensureTopology без манифеста. */
export function listSystemTopicRoutingKeys(): readonly string[] {
  return Object.values(RADAR_TOPICS);
}

/**
 * Каталог топиков из pipeline.manifest (trigger.on + emits) ∪ системные константы.
 * SSOT для ensureTopology.
 */
export function buildTopicCatalog(manifest: PipelineManifest): readonly string[] {
  const keys = new Set<string>(listSystemTopicRoutingKeys());
  for (const step of manifest.steps) {
    for (const key of step.trigger.on) keys.add(key);
    for (const key of step.emits) keys.add(key);
  }
  return [...keys].sort();
}

/** Известные доменные типы → routing key (до полного перехода publish через StepEgressGate). */
const KNOWN_EVENT_TOPICS: Partial<Record<string, string>> = {
  RawMessageIngested: RADAR_TOPICS.RAW_INGESTED,
  MessageParsed: RADAR_TOPICS.MESSAGE_PARSED,
  MessageParseFailed: RADAR_TOPICS.MESSAGE_PARSED,
  // PipelineStabilized → routing из step.emits (stabilizedEmitKeyForPipeline + topic override).
  ChannelBackfillCompleted: RADAR_TOPICS.CHANNEL_BACKFILL_COMPLETED,
  StepRunRequested: RADAR_TOPICS.STEP_RUN_REQUESTED,
  StepResetRequested: RADAR_TOPICS.STEP_RESET_REQUESTED,
  StepStarted: RADAR_TOPICS.STEP_STARTED,
  StepDrained: RADAR_TOPICS.STEP_DRAINED,
  StepFailed: RADAR_TOPICS.STEP_FAILED,
  SystemInit: RADAR_TOPICS.SYSTEM_INIT,
  SystemDrain: RADAR_TOPICS.SYSTEM_DRAIN,
};

export function topicForKnownEventType(type: string): string | null {
  return KNOWN_EVENT_TOPICS[type] ?? null;
}

export function drainTopicForPhaseScope(scope: "ingestParse" | "geoParse"): string {
  return scope === "geoParse" ? RADAR_TOPICS.RUNNER_DRAIN_GEO : RADAR_TOPICS.RUNNER_DRAIN_PARSE;
}
