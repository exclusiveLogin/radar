/**
 * Структурированный итог вызова LLM enrich/validate.
 * disabled / no-signal — штатное завершение; transport / json / schema — после ретраев → fail фазы.
 */
export type LlmOpFailReason = "disabled" | "no-signal" | "transport" | "json" | "schema";

export type LlmOpResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: LlmOpFailReason };

/** Причины, после которых фаза llm / llm-validator помечается failed. */
export function isLlmOpHardFailure(reason: LlmOpFailReason): boolean {
  return reason === "transport" || reason === "json" || reason === "schema";
}
