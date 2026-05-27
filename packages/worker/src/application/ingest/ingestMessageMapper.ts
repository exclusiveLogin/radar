import type { IngestMode, IngestNormalizedMessage, RawMessage, RawMessageTelegramExtension } from "@radar/shared";
import { ingestMessageHash } from "@radar/shared";

/** Нормализованное сообщение adapter → RawMessage для IngestRawMessageHandler. */
export function ingestNormalizedToRaw(
  normalized: IngestNormalizedMessage,
  ingestMode: IngestMode = normalized.ingestMode ?? "live",
): { raw: RawMessage; extension?: RawMessageTelegramExtension } {
  const hash =
    normalized.hash ??
    ingestMessageHash({
      channelKey: normalized.channelKey,
      providerKey: normalized.providerKey,
      sourceKind: normalized.sourceKind,
      externalMessageId: normalized.externalMessageId,
      revisionKey: normalized.revisionKey ?? null,
      postedAt: normalized.postedAt,
      rawText: normalized.rawText,
      rawPayload: normalized.rawPayload,
    });

  const raw: RawMessage = {
    channelKey: normalized.channelKey,
    providerKey: normalized.providerKey,
    sourceKind: normalized.sourceKind,
    externalMessageId: normalized.externalMessageId,
    revisionKey: normalized.revisionKey ?? null,
    sourceSequence: normalized.sourceSequence ?? null,
    postedAt: normalized.postedAt,
    ingestMode,
    rawText: normalized.rawText,
    rawPayload: normalized.rawPayload,
    hash,
    fetchedAt: new Date().toISOString(),
  };

  const extension = normalized.telegramExtension
    ? {
        rawMessageId: "",
        chatId: normalized.telegramExtension.chatId,
        messageId: normalized.telegramExtension.messageId,
        editDate: normalized.telegramExtension.editDate,
        peerType: normalized.telegramExtension.peerType,
      }
    : undefined;

  return { raw, extension };
}
