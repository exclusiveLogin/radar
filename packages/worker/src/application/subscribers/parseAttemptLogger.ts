import type { DomainEvent, EventHandler } from "@radar/shared";
import { isCliProgressActive } from "../../infrastructure/cliProgressGate.js";

const CHANNEL_LIMIT = 24;
const TEXT_LIMIT = 96;
const REASON_LIMIT = 72;

/** Последний сегмент UUID: `b6a6776e-…-84cbb4dca547` → `-84cbb4dca547`. */
function shortAggregateId(id: string | null | undefined): string {
  if (!id) return "-n/a";
  const dash = id.lastIndexOf("-");
  if (dash >= 0 && dash < id.length - 1) return id.slice(dash);
  return `-${id.slice(-12)}`;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

/** Одна строка лога: без переносов, с жёстким лимитом символов. */
function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  if (max <= 1) return "…";
  return `${flat.slice(0, max - 1)}…`;
}

/**
 *Stdout/stderr след parse-попыток (verbose или вне cli-progress).
 * Формат: timestamp type id ch=… text=… reason=…
 */
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

    const payload = event.payload;
    const id = shortAggregateId(event.aggregateId);
    const channel = clip(readString(payload, "channelKey") ?? "?", CHANNEL_LIMIT);
    const text = clip(readString(payload, "rawText") ?? "", TEXT_LIMIT);
    const reason =
      event.type === "MessageParseFailed"
        ? clip(readString(payload, "reason") ?? "", REASON_LIMIT)
        : null;

    const parts = [
      `[ParseAttemptLogger]`,
      event.occurredAt,
      event.type,
      id,
      `ch=${channel}`,
    ];
    if (text) parts.push(`text=${text}`);
    if (reason) parts.push(`reason=${reason}`);

    console.error(parts.join(" "));
  };
}
