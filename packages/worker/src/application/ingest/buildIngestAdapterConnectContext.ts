import type {
  IngestAdapterContext,
  IngestProviderRecord,
  TelegramMtprotoAppCredentials,
} from "@radar/shared";
import type { SessionResolver } from "../sessions/sessionResolver.js";

/** MTProxy из env (опционально). */
export function resolveMtproxyFromEnv(): { ip: string; port: number; secret: string } | null {
  const ip = process.env.TELEGRAM_MTPROXY_HOST?.trim();
  const port = Number(process.env.TELEGRAM_MTPROXY_PORT);
  const secret = process.env.TELEGRAM_MTPROXY_SECRET?.trim();
  if (!ip || !port || !secret) return null;
  return { ip, port, secret };
}

/**
 * Единая сборка IngestAdapterContext для orchestrator / backfill / CLI chunk.
 * Слоты — из provider.credentialRefs; api_id/hash — из composition root.
 */
export function buildIngestAdapterConnectContext(input: {
  provider: IngestProviderRecord;
  sessionResolver: SessionResolver;
  telegramMtprotoApp: TelegramMtprotoAppCredentials;
}): IngestAdapterContext {
  const { provider, sessionResolver, telegramMtprotoApp } = input;
  return {
    provider,
    telegramMtprotoApp,
    resolveMtproxy: resolveMtproxyFromEnv,
    resolveSessionSecret: async (slotKey) => {
      const material = await sessionResolver.resolveMaterial(
        slotKey,
        slotKey.includes("bot") ? "bot_token" : "mtproto_user",
      );
      return material.secret;
    },
  };
}
