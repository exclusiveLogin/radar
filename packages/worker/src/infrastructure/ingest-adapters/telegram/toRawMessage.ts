import type { Api } from "telegram";
import type { IngestNormalizedMessage } from "@radar/shared";

function peerTypeFromMessage(
  msg: Api.Message,
): "channel" | "group" | "supergroup" | "user" | undefined {
  const peer = msg.peerId;
  if (!peer) return undefined;
  const cls = peer.className ?? "";
  if (cls.includes("Channel")) return "channel";
  if (cls.includes("Chat")) return "group";
  if (cls.includes("User")) return "user";
  return undefined;
}

function postedAtIso(msg: Api.Message): string {
  const date = msg.date ?? Math.floor(Date.now() / 1000);
  return new Date(date * 1000).toISOString();
}

function messageText(msg: Api.Message): string {
  if (typeof msg.message === "string" && msg.message.trim()) {
    return msg.message.trim();
  }
  if (msg.media) {
    return "[media]";
  }
  return "";
}

/**
 * ACL: GramJS Message → нормализованное сообщение для ingest pipeline.
 */
export function mapTelegramMessage(input: {
  msg: Api.Message;
  channelKey: string;
  providerKey: string;
  ingestMode: "live" | "backfill" | "manual";
}): IngestNormalizedMessage | null {
  const { msg, channelKey, providerKey, ingestMode } = input;
  const rawText = messageText(msg);
  if (!rawText) return null;

  const chatId = String(msg.chatId ?? msg.peerId ?? "");
  const messageId = String(msg.id);
  const editDate =
    msg.editDate && msg.editDate > 0
      ? new Date(msg.editDate * 1000).toISOString()
      : null;

  return {
    channelKey,
    providerKey,
    sourceKind: "telegram",
    externalMessageId: messageId,
    revisionKey: editDate,
    sourceSequence: messageId,
    postedAt: postedAtIso(msg),
    ingestMode,
    rawText,
    rawPayload: {
      telegram: {
        chatId,
        messageId,
        editDate,
        peerId: chatId,
      },
    },
    telegramExtension: {
      chatId,
      messageId,
      editDate,
      peerType: peerTypeFromMessage(msg),
    },
  };
}

/** Bot API update → тот же ACL. */
export function mapTelegramBotUpdate(input: {
  message: {
    message_id: number;
    chat: { id: number; type?: string };
    date: number;
    edit_date?: number;
    text?: string;
  };
  channelKey: string;
  providerKey: string;
  ingestMode: "live" | "backfill" | "manual";
}): IngestNormalizedMessage | null {
  const { message, channelKey, providerKey, ingestMode } = input;
  const rawText = message.text?.trim() ?? "";
  if (!rawText) return null;

  const chatId = String(message.chat.id);
  const messageId = String(message.message_id);
  const editDate =
    message.edit_date && message.edit_date > 0
      ? new Date(message.edit_date * 1000).toISOString()
      : null;

  const peerType =
    message.chat.type === "channel"
      ? "channel"
      : message.chat.type === "supergroup"
        ? "supergroup"
        : message.chat.type === "group"
          ? "group"
          : message.chat.type === "private"
            ? "user"
            : undefined;

  return {
    channelKey,
    providerKey,
    sourceKind: "telegram",
    externalMessageId: messageId,
    revisionKey: editDate,
    sourceSequence: messageId,
    postedAt: new Date(message.date * 1000).toISOString(),
    ingestMode,
    rawText,
    rawPayload: {
      telegram: { chatId, messageId, editDate, peerId: chatId },
    },
    telegramExtension: { chatId, messageId, editDate, peerType },
  };
}
