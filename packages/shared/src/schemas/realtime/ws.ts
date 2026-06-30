import { z } from "zod";
import {
  mapSnapshotSchema,
  placeStateEventSchema,
  regionStateEventSchema,
  warningSchema,
} from "../geo/region-state";

/**
 * Контракты WebSocket-канала карты. Сервер шлёт обновления состояния регионов
 * и предупреждения; клиент подписывается/отписывается на каналы.
 */

export const wsChannelSchema = z.enum(["region-state", "place-state", "warnings", "tracks"]);

/** Сообщение клиента: подписка/отписка на набор каналов. */
export const wsClientMessageSchema = z.object({
  type: z.enum(["subscribe", "unsubscribe"]),
  channels: z.array(wsChannelSchema).min(1),
});

/** Сигнал обновления треков после батча rebuild. */
export const tracksUpdatedPayloadSchema = z.object({
  at: z.string().datetime(),
});

/** Сообщения сервера (discriminated union по `type`). */
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), payload: mapSnapshotSchema }),
  z.object({ type: z.literal("region-state"), payload: regionStateEventSchema }),
  z.object({ type: z.literal("place-state"), payload: placeStateEventSchema }),
  z.object({ type: z.literal("warning"), payload: warningSchema }),
  z.object({ type: z.literal("tracks-updated"), payload: tracksUpdatedPayloadSchema }),
]);

export type WsChannel = z.infer<typeof wsChannelSchema>;
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
