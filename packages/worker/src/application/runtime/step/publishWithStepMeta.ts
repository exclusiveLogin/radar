/**
 * ---
 * layer: worker/application
 * domain: pipeline/step
 * purpose: Публикация domain event с опциональным meta (lane/isolate/stepId).
 * ---
 */
import type { DomainEvent, DomainEventMeta, IEventTransport } from "@radar/shared";
import { publishDomainEventViaTransport } from "../../handlers/ingestEventPublishMode.js";
import type { LogStepRunRepository } from "./logStepRunRepository.js";

export type PublishWithStepMetaInput = {
  transport: IEventTransport;
  event: DomainEvent;
  meta?: DomainEventMeta;
  /** Опционально: открыть/закрыть log_step_run вокруг publish (лёгкая обёртка). */
  logSteps?: LogStepRunRepository;
  stepIdForLog?: string;
};

/** Прикрепляет meta и публикует через transport; опционально пишет log_step_run. */
export async function publishDomainEventWithStepMeta(
  input: PublishWithStepMetaInput,
): Promise<void> {
  const event: DomainEvent = input.meta
    ? { ...input.event, meta: { ...input.event.meta, ...input.meta } }
    : input.event;

  let runId: string | undefined;
  if (input.logSteps && input.stepIdForLog) {
    runId = await input.logSteps.open({
      stepId: input.stepIdForLog,
      lane: event.meta?.lane,
      isolate: event.meta?.isolate,
      correlationId: event.meta?.correlationId,
      triggerTopic: event.type,
      triggerSource: "system",
    });
  }

  try {
    await publishDomainEventViaTransport(input.transport, event);
    if (input.logSteps && runId) {
      await input.logSteps.close(runId, "completed", { published: event.type });
    }
  } catch (err) {
    if (input.logSteps && runId) {
      await input.logSteps
        .close(runId, "failed", undefined, err instanceof Error ? err.message : String(err))
        .catch(() => undefined);
    }
    throw err;
  }
}
