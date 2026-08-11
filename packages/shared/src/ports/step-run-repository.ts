/**
 * ---
 * layer: shared/ports
 * bounded-context: pipeline/step
 * purpose: Журнал запусков шага (log_step_run).
 * ---
 */
import type { IngestMode } from "../schemas/ingest/ingest-domain.js";
import type { StepTriggerSource } from "../domain/pipeline/step/stepRunContext.js";

export type StepRunStatus = "running" | "completed" | "failed" | "canceled";

export type StepRunSuppressedEmit = {
  key: string;
  payloadSummary: Record<string, unknown>;
  downstreamStepIds: string[];
};

export type StepRunRecord = {
  id: string;
  stepId: string;
  runId: string;
  lane: IngestMode;
  isolate: boolean;
  triggerTopic: string;
  triggerSource: StepTriggerSource;
  correlationId: string;
  status: StepRunStatus;
  stats: Record<string, unknown>;
  suppressedEmits: StepRunSuppressedEmit[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StepRunOpenInput = {
  stepId: string;
  runId: string;
  lane: IngestMode;
  isolate: boolean;
  triggerTopic: string;
  triggerSource: StepTriggerSource;
  correlationId: string;
};

export interface IStepRunRepository {
  open(input: StepRunOpenInput): Promise<StepRunRecord>;
  findByRunId(runId: string): Promise<StepRunRecord | null>;
  close(
    runId: string,
    patch: {
      status: StepRunStatus;
      stats?: Record<string, unknown>;
      suppressedEmits?: StepRunSuppressedEmit[];
    },
  ): Promise<void>;
}
