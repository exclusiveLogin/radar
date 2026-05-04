import { z } from "zod";

/** Курсор инкремента: либо по id сообщения, либо по времени (ISO 8601). */
export const parseCursorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message_id"),
    messageId: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("date"),
    /** Например `2025-05-04T12:00:00.000Z` */
    dateIso: z.string().min(1),
  }),
]);

export type ParseCursor = z.infer<typeof parseCursorSchema>;

/**
 * Настройки выборки из канала (лимиты, курсор, «читаемое»).
 * Дальше свяжем с ORM-сущностью ingest state / channel cursor.
 */
export const parseConfigSchema = z.object({
  /** Сколько сообщений за один проход (верхняя граница — на усмотрение Telegram API). */
  batchLimit: z.number().int().min(1).max(5000).default(100),
  /** Отмечать входящие прочитанными при парсинге (осторожно: меняет read receipts). */
  markAsRead: z.boolean().default(false),
  cursor: parseCursorSchema.optional(),
});

export type ParseConfig = z.infer<typeof parseConfigSchema>;
