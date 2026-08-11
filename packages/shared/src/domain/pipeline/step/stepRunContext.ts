/**
 * ---
 * layer: shared
 * domain: pipeline/step
 * purpose: Контекст одного запуска шага — рождается из триггера, живёт весь прогон.
 * ---
 */
import type { IngestMode } from "../../../schemas/ingest/ingest-domain.js";

export type StepTriggerSource = "bus" | "scheduler" | "manual" | "cli" | "system";

export type StepRunContext = {
  stepId: string;
  runId: string;
  lane: IngestMode;
  isolate: boolean;
  correlationId: string;
  trigger: {
    topic: string;
    source: StepTriggerSource;
    eventId?: string;
  };
  ids?: string[];
};

/** Эмит из доменного evaluate — ключ должен быть в step.emits[]. */
export type StepEmit = {
  key: string;
  payload: Record<string, unknown>;
  aggregateId?: string | null;
};
