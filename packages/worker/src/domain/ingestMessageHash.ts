import { createHash } from "node:crypto";

/** Вход для стабильного дедуп-ключа сообщения в хранилище. */
export type IngestMessageHashInput = {
  /** Ключ канала из манифеста (`ChannelManifestEntry.key`). */
  channelKey: string;
  telegramMessageId: number;
  /** Если сообщение редактировалось — учитываем для смены hash. */
  editDate?: number;
};

/**
 * Уникальный детерминированный hash для строки в БД (SHA-256 hex).
 * Контракт можно позже перенести в @radar/shared, если понадобится API.
 */
export function ingestMessageHash(input: IngestMessageHashInput): string {
  const payload = JSON.stringify({
    c: input.channelKey,
    m: input.telegramMessageId,
    e: input.editDate ?? null,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
