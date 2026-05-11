import {
  parseConfigSchema,
  type ChannelManifest,
  type ParseConfig,
} from "@radar/shared";

export type PlannedChannelIngest = {
  channelKey: string;
  telegramTarget: string;
  effectiveConfig: ParseConfig;
};

function mergeParseConfig(
  base: ParseConfig,
  overrides: Partial<ParseConfig> | undefined,
): ParseConfig {
  if (!overrides) {
    return base;
  }
  return parseConfigSchema.parse({ ...base, ...overrides });
}

function toPlannedIngest(
  channel: ChannelManifest["channels"][number],
  defaultParseConfig: ParseConfig,
): PlannedChannelIngest {
  return {
    channelKey: channel.key,
    telegramTarget: channel.telegramTarget,
    effectiveConfig: mergeParseConfig(defaultParseConfig, channel.parseOverrides),
  };
}

/**
 * План проходов по каналам (без вызовов Telegram — следующий шаг: хендлеры GramJS + ORM).
 */
export function planChannelIngests(options: {
  manifest: ChannelManifest | null;
  defaultParseConfig: ParseConfig;
}): PlannedChannelIngest[] {
  const { manifest, defaultParseConfig } = options;
  if (!manifest) {
    return [];
  }

  return manifest.channels
    .filter((channel) => channel.enabled)
    .map((channel) => toPlannedIngest(channel, defaultParseConfig));
}
