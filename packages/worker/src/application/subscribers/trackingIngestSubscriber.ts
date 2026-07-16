import type { DomainEvent } from "@radar/shared";
import { extractEventLocationIdsFromParsedPayload } from "../runtime/workload/pipelineWakeContract.js";
import { offerTrackingWakeIds } from "../tracking/trackingWakePriority.js";

export type TrackingIngestHandlerDeps = {
  onWake?: () => void;
};

/** MessageParsed → приоритет eventLocationIds + wake tracking. */
export function createTrackingIngestHandler(
  deps: TrackingIngestHandlerDeps,
): (event: DomainEvent) => Promise<void> {
  return async (event: DomainEvent) => {
    if (event.type !== "MessageParsed") return;
    const ids = extractEventLocationIdsFromParsedPayload(
      event.payload as Record<string, unknown>,
    );
    if (ids.length > 0) offerTrackingWakeIds(ids);
    deps.onWake?.();
  };
}