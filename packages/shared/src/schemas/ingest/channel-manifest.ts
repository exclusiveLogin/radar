import { z } from "zod";
import { parseConfigSchema } from "./parse-config";

const parseOverridesSchema = parseConfigSchema.partial();

/** Одна запись в манифесте каналов (username, t.me slug или peer id строкой). */
export const channelManifestEntrySchema = z.object({
  /** Стабильный ключ внутри продукта (для hash и FK). */
  key: z.string().min(1),
  /** Идентификатор в Telegram: `@channel`, `t.me/...` или числовой id как строка. */
  telegramTarget: z.string().min(1),
  title: z.string().optional(),
  enabled: z.boolean().default(true),
  parseOverrides: parseOverridesSchema.optional(),
});

export type ChannelManifestEntry = z.infer<typeof channelManifestEntrySchema>;

export const channelManifestSchema = z.object({
  version: z.literal(1),
  channels: z.array(channelManifestEntrySchema),
});

export type ChannelManifest = z.infer<typeof channelManifestSchema>;
