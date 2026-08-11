/**
 * ChannelBackfillCompleted → снять inProgress-флаг + wake parse (forward после bfend).
 */
import type { DomainEvent, IIngestCursorRepository } from "@radar/shared";

export type ChannelBackfillCompletedHandlerDeps = {
  cursors: IIngestCursorRepository;
  onWakeParse?: () => void;
};

/** После bfend: UI/наблюдаемость видят inProgress=false; parse будится на хвост очереди. */
export function createChannelBackfillCompletedHandler(
  deps: ChannelBackfillCompletedHandlerDeps,
): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "ChannelBackfillCompleted") return;
    const payload = event.payload as Record<string, unknown>;
    const channelKey = typeof payload.channelKey === "string" ? payload.channelKey : null;
    const providerKey = typeof payload.providerKey === "string" ? payload.providerKey : null;
    const jobId = typeof payload.jobId === "string" ? payload.jobId : null;
    if (!channelKey || !providerKey) return;

    await deps.cursors.updateBackfillState(channelKey, providerKey, {
      inProgress: false,
      status: "completed",
      completedAt: event.occurredAt,
      ...(jobId ? { jobId } : {}),
    });
    deps.onWakeParse?.();
  };
}
