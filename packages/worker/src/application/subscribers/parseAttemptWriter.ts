import type {
  DomainEvent,
  EventHandler,
  IParseAttemptRepository,
  ParseAttemptInput,
} from "@radar/shared";
import { PARSER_VERSION } from "../../domain/parsing/version.js";

/** Безопасно достаёт строковое поле из payload события. */
function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

/**
 * Пишет технический след парсинга в parse_attempts по событиям шины:
 * - `MessageParsed` → ok
 * - `MessageParseFailed` с `outcome=failed` → failed (реальная ошибка парсера)
 * - прочие `MessageParseFailed` (не событие) → skipped
 * Заменяет stdout-only ParseAttemptLogger в db-режиме worker.
 */
export class ParseAttemptWriter {
  constructor(private readonly repo: IParseAttemptRepository) {}

  readonly handler: EventHandler = async (event: DomainEvent) => {
    const input = this.toInput(event);
    if (!input) return;
    await this.repo.append(input);
  };

  private toInput(event: DomainEvent): ParseAttemptInput | null {
    if (event.type !== "MessageParsed" && event.type !== "MessageParseFailed") {
      return null;
    }
    const payload = event.payload;
    const rawMessageId =
      readString(payload, "rawMessageId") ??
      (event.type === "MessageParseFailed" ? event.aggregateId : null);
    if (!rawMessageId) return null;

    const status =
      event.type === "MessageParsed"
        ? "ok"
        : payload.outcome === "failed"
          ? "failed"
          : "skipped";

    const errors =
      payload.errors && typeof payload.errors === "object"
        ? (payload.errors as Record<string, unknown>)
        : status === "skipped"
          ? null
          : { reason: readString(payload, "reason") ?? "unknown" };

    return {
      rawMessageId,
      channelKey: readString(payload, "channelKey"),
      parserVersion: readString(payload, "parserVersion") ?? PARSER_VERSION,
      status,
      errors,
    };
  }
}
