/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Контракты WebSocket-канала админки (/ws/admin): телеметрия, parse-лог, backfill.
 * ---
 */
import { z } from "zod";
import { workerStatusResponseSchema } from "../worker-status";
import { backfillJobListItemSchema } from "./backfill";
import { parseAttemptItemSchema } from "./parse-attempt";

export const adminWsChannelSchema = z.enum([
  "worker-status",
  "parse-log",
  "backfill-progress",
]);

/** Сообщение клиента: подписка/отписка на набор каналов админки. */
export const adminWsClientMessageSchema = z.object({
  type: z.enum(["subscribe", "unsubscribe"]),
  channels: z.array(adminWsChannelSchema).min(1),
});

/** Сообщения сервера админ-WS (discriminated union по `type`). */
export const adminWsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worker-status"), payload: workerStatusResponseSchema }),
  z.object({ type: z.literal("parse-log"), payload: parseAttemptItemSchema }),
  z.object({ type: z.literal("backfill-progress"), payload: backfillJobListItemSchema }),
]);

export type AdminWsChannel = z.infer<typeof adminWsChannelSchema>;
export type AdminWsClientMessage = z.infer<typeof adminWsClientMessageSchema>;
export type AdminWsServerMessage = z.infer<typeof adminWsServerMessageSchema>;
