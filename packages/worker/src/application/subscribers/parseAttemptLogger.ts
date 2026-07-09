import type { DomainEvent, EventHandler } from "@radar/shared";
import { isCliProgressActive } from "../../infrastructure/cliProgressGate.js";

export class ParseAttemptLogger {
  constructor(private readonly verbose = false) {}

  readonly handler: EventHandler = async (event: DomainEvent) => {
    if (
      event.type !== "MessageParsed" &&
      event.type !== "MessageParseFailed"
    ) {
      return;
    }
    // stdout занят cli-progress; подробности — в log_parse_attempt (БД) или logging.verboseParse в manifest
    if (isCliProgressActive() && !this.verbose) return;

    console.error(
      `[ParseAttemptLogger] ${event.type} aggregate=${event.aggregateType}:${event.aggregateId ?? "n/a"}`,
    );
  };
}
