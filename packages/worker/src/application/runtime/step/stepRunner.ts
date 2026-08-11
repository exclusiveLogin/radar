/**
 * ---
 * layer: worker/runtime
 * domain: pipeline/step
 * purpose: Координатор одного step-run: journal open → wake → wait idle → close.
 * ---
 */
import type {
  IEventTransport,
  PipelineKey,
  PipelineManifest,
  StepRunContext,
} from "@radar/shared";
import type { LogStepRunRepository } from "./logStepRunRepository.js";
import {
  publishStepDrained,
  publishStepFailed,
  publishStepStarted,
  type SuppressedEmit,
} from "./stepEgressGate.js";
import { routeStepWake, type StepWakePort } from "./stepTriggerRouter.js";

export type StepRunnerDeps = {
  manifest: PipelineManifest;
  wake: StepWakePort;
  hasWakeable?: (pipelineKey: PipelineKey) => boolean;
  logSteps?: LogStepRunRepository;
  transport?: IEventTransport;
  /** Опционально ждать стабильности после wake. */
  waitUntilIdle?: (ctx: StepRunContext) => Promise<void>;
};

export type StepRunnerResult = {
  runId: string;
  matches: number;
  status: "completed" | "failed";
  suppressedEmits: SuppressedEmit[];
  error?: string;
};

/** Исполняет step run: журнал + wake launcher (+ optional idle wait). */
export async function runStep(input: {
  deps: StepRunnerDeps;
  ctx: StepRunContext;
}): Promise<StepRunnerResult> {
  const { deps, ctx } = input;
  const step = deps.manifest.steps.find((s) => s.id === ctx.stepId);
  if (!step?.enabled) {
    throw new Error(`step not found or disabled: ${ctx.stepId}`);
  }

  const suppressedEmits: SuppressedEmit[] = [];
  let runId = ctx.runId;

  try {
    if (deps.logSteps) {
      runId = await deps.logSteps.open({
        stepId: ctx.stepId,
        runId: ctx.runId,
        lane: ctx.lane,
        isolate: ctx.isolate,
        correlationId: ctx.correlationId,
        triggerTopic: ctx.trigger.topic,
        triggerSource: ctx.trigger.source,
      });
    }

    const runCtx: StepRunContext = { ...ctx, runId };

    if (deps.transport) {
      await publishStepStarted(deps.transport, runCtx);
    }

    routeStepWake({
      matches: [{ stepId: step.id, pipelineKey: step.pipelineKey }],
      wake: deps.wake,
      hasWakeable: deps.hasWakeable,
    });

    if (deps.waitUntilIdle) {
      await deps.waitUntilIdle(runCtx);
    }

    if (deps.transport) {
      await publishStepDrained(deps.transport, runCtx, { woken: true });
    }

    if (deps.logSteps) {
      await deps.logSteps.close(runId, "completed", {
        woken: true,
        suppressedEmits,
      });
    }

    return { runId, matches: 1, status: "completed", suppressedEmits };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const runCtx: StepRunContext = { ...ctx, runId };
    if (deps.transport) {
      await publishStepFailed(deps.transport, runCtx, reason).catch(() => undefined);
    }
    if (deps.logSteps) {
      await deps.logSteps
        .close(runId, "failed", { suppressedEmits }, reason)
        .catch(() => undefined);
    }
    return {
      runId,
      matches: 0,
      status: "failed",
      suppressedEmits,
      error: reason,
    };
  }
}
