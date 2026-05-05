import type { DomainEvent, EventHandler } from "@radar/shared";

export class ParseAttemptLogger {
  readonly handler: EventHandler = async (event: DomainEvent) => {
    if (
      event.type !== "MessageParsed" &&
      event.type !== "MessageParseFailed"
    ) {
      return;
    }
    console.log(
      `[ParseAttemptLogger] ${event.type} aggregate=${event.aggregateType}:${event.aggregateId ?? "n/a"}`,
    );
  };
}
