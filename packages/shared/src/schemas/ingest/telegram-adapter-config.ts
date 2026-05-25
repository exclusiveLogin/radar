import { z } from "zod";
import { mtproxyTransportSchema } from "./mtproxy-transport";

export const telegramAdapterConfigSchema = z.object({
  kind: z.literal("telegram"),
  mtproxy: mtproxyTransportSchema.optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  historyBatchSize: z.number().int().positive().optional(),
});

export type TelegramAdapterConfig = z.infer<typeof telegramAdapterConfigSchema>;
