import { createHash } from "node:crypto";

/** Универсальные поля для content fingerprint (без transport-specific top-level). */
export type RawMessageHashInput = {
  channelKey: string;
  providerKey: string;
  sourceKind: string;
  externalMessageId: string;
  revisionKey?: string | null;
  postedAt: string;
  rawText: string;
  rawPayload?: Record<string, unknown>;
};

const TELEGRAM_PAYLOAD_KEYS = ["chatId", "messageId", "editDate", "peerId"] as const;

/** Whitelist стабильных полей rawPayload по sourceKind для hash. */
function rawPayloadStable(
  sourceKind: string,
  rawPayload?: Record<string, unknown>,
): Record<string, unknown> {
  if (!rawPayload) return {};
  if (sourceKind === "telegram") {
    const tg = rawPayload.telegram as Record<string, unknown> | undefined;
    if (!tg) return {};
    const slice: Record<string, unknown> = {};
    for (const key of TELEGRAM_PAYLOAD_KEYS) {
      if (tg[key] !== undefined) slice[key] = tg[key];
    }
    return { telegram: slice };
  }
  if (sourceKind === "manual") {
    const manual = rawPayload.manual as Record<string, unknown> | undefined;
    return manual ? { manual } : {};
  }
  return {};
}

/**
 * Content fingerprint сырого сообщения (SHA-256 hex).
 * SSOT для API и worker — duplicate detection по hash.
 */
export function ingestMessageHash(input: RawMessageHashInput): string {
  const payload = JSON.stringify({
    channelKey: input.channelKey,
    providerKey: input.providerKey,
    sourceKind: input.sourceKind,
    externalMessageId: input.externalMessageId,
    revisionKey: input.revisionKey ?? null,
    postedAt: input.postedAt,
    rawText: input.rawText,
    rawPayloadStable: rawPayloadStable(input.sourceKind, input.rawPayload),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
