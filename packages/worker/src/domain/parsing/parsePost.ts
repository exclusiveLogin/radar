import type { ClassifiedPost, EventType } from "@radar/shared";
import { extractCounts } from "./extractCounts.js";
import { extractDirection } from "./extractDirection.js";
import { extractEventSubject, extractEventType } from "./extractEventType.js";
import { extractMacroZone } from "./extractMacroZone.js";
import { extractRepeatFlag } from "./extractRepeatFlag.js";
import { inferSeverity } from "./inferSeverity.js";
import { PARSER_VERSION } from "./version.js";

const UNKNOWN_RAW_MESSAGE_ID = "00000000-0000-0000-0000-000000000000";

/** Собирает DTO события для пайплайна, если текст классифицирован как тревога/сигнал. Иначе — «шум». */
export function parsePost(rawPost: string): ClassifiedPost {
  const eventType = extractEventType(rawPost);
  if (!eventType) {
    return { kind: "noise", reason: "event_type_not_detected" };
  }

  return {
    kind: "event",
    event: {
      rawMessageId: UNKNOWN_RAW_MESSAGE_ID,
      eventType,
      eventSubject: extractEventSubject(rawPost),
      severity: inferSeverity(rawPost, eventType),
      repeat: extractRepeatFlag(rawPost),
      count: extractCounts(rawPost),
      direction: extractDirection(rawPost),
      macroZone: extractMacroZone(rawPost),
      locations: [],
      postedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      confidence: 0.8,
      extras: { rawPost },
    },
  };
}
