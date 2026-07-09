import type { DomainEvent, EventHandler } from "@radar/shared";
import { isCliProgressActive } from "../../infrastructure/cliProgressGate.js";

function isVerboseParseLog(): boolean {
  const raw = process.env.RADAR_VERBOSE_PARSE_LOG?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export class ParseAttemptLogger {
  readonly handler: EventHandler = async (event: DomainEvent) => {
    if (
      event.type !== "MessageParsed" &&
      event.type !== "MessageParseFailed"
    ) {
      return;
    }
    // stdout занят cli-progress; подробности — в log_parse_attempt (БД) или RADAR_VERBOSE_PARSE_LOG=1
    if (isCliProgressActive() && !isVerboseParseLog()) return;

    console.error(
      `[ParseAttemptLogger] ${event.type} aggregate=${event.aggregateType}:${event.aggregateId ?? "n/a"}`,
    );
  };
}
