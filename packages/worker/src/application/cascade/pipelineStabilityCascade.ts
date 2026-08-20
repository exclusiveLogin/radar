/**
 * ---
 * layer: worker/application
 * domain: cascade
 * purpose: App-обвязка stabilityEngine → DomainEvent. Раннер не знает про RMQ.
 *          Routing key для stabilized — только из DSL (step.emits), не хардкод.
 * ---
 */
import type { IEventTransport, PipelineKey } from "@radar/shared";
import {
  createChannelBackfillCompletedEvent,
  createPipelineStabilizedEvent,
} from "@radar/shared";
import { publishDomainEventViaTransport } from "../handlers/ingestEventPublishMode.js";
import type { JobKernelObsPort } from "../runtime/runner-platform/jobKernel.js";
import {
  channelBackfillStabilityScope,
  pipelineStabilityScope,
  type StabilityEngine,
} from "../runtime/runner-platform/stabilityEngine.js";

export type PipelineStabilityCascadeDeps = {
  engine: StabilityEngine;
  transport: IEventTransport;
  pipelineKey: PipelineKey;
  /** true = в персисте ещё есть работа по всему pipeline (все фазы/реплики). */
  hasPendingWork: () => Promise<boolean>;
  /**
   * Routing key из `step.emits` (`*.stabilized`).
   * null → claim idle без bus-publish (нет downstream в DSL).
   */
  stabilizedRoutingKey: string | null;
};

/**
 * Obs-порт: busy при работе, idle→claim→PipelineStabilized при дренированной очереди.
 * hasPendingWork перепроверяет персист перед claim (гонки реплик).
 */
export function createPipelineStabilityObsPort(
  deps: PipelineStabilityCascadeDeps,
): JobKernelObsPort {
  const scopeKey = pipelineStabilityScope(deps.pipelineKey);
  return {
    onBusy: async () => {
      await deps.engine.reportBusy(scopeKey);
    },
    onIdle: async () => {
      if (await deps.hasPendingWork()) return;
      const claimed = await deps.engine.reportIdle(scopeKey);
      if (!claimed) return;
      if (!deps.stabilizedRoutingKey) return;
      await publishDomainEventViaTransport(
        deps.transport,
        createPipelineStabilizedEvent({ pipelineKey: deps.pipelineKey }),
        deps.stabilizedRoutingKey,
      );
    },
  };
}

export type ChannelBackfillStabilityDeps = {
  engine: StabilityEngine;
  transport: IEventTransport;
};

/** После historyExhausted: claim channel-scope → ChannelBackfillCompleted. */
export async function publishChannelBackfillCompletedIfStable(
  deps: ChannelBackfillStabilityDeps,
  input: {
    channelId: string;
    channelKey: string;
    providerKey: string;
    jobId: string;
    /** Есть ли ещё runnable backfill по этому каналу. */
    hasPendingChannelWork: () => Promise<boolean>;
  },
): Promise<boolean> {
  const scopeKey = channelBackfillStabilityScope(input.channelId);
  if (await input.hasPendingChannelWork()) return false;
  const claimed = await deps.engine.reportIdle(scopeKey);
  if (!claimed) return false;
  await publishDomainEventViaTransport(
    deps.transport,
    {
      ...createChannelBackfillCompletedEvent({
        channelId: input.channelId,
        channelKey: input.channelKey,
        providerKey: input.providerKey,
        jobId: input.jobId,
      }),
      meta: {
        stepId: "ingest-backfill",
        lane: "backfill",
      },
    },
  );
  return true;
}

/** Пометить channel-backfill busy при старте/батче job. */
export async function markChannelBackfillBusy(
  engine: StabilityEngine,
  channelId: string,
): Promise<void> {
  await engine.reportBusy(channelBackfillStabilityScope(channelId));
}
