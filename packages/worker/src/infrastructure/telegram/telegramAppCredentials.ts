import type { TelegramMtprotoAppCredentials } from "@radar/shared";

/**
 * api_id / api_hash для GramJS.
 * @see https://github.com/telegramdesktop/tdesktop/blob/dev/docs/api_credentials.md
 */

/**
 * TEST ONLY из документации Telegram Desktop (не production Desktop 2040 — с GramJS даёт API_ID_INVALID).
 * Ограничены на сервере; для продакшена — свои ключи с https://my.telegram.org
 */
export const TELEGRAM_TEST_API_ID = 17349;
export const TELEGRAM_TEST_API_HASH = "344583e45741c457fe1862106095a5eb";

export type TelegramAppCredentials = {
  apiId: number;
  apiHash: string;
  /** Откуда взяты ключи — для логов. */
  source: "env" | "telegram_test_default";
};

let defaultCredentialsWarned = false;

function readEnvTelegramAppCredentials(): TelegramAppCredentials | null {
  const rawId = process.env.TELEGRAM_API_ID?.trim() ?? "";
  const envHash = process.env.TELEGRAM_API_HASH?.trim() ?? "";
  if (!rawId && !envHash) return null;

  const envId = Number(rawId);
  if (!Number.isInteger(envId) || envId <= 0) {
    throw new Error(
      `TELEGRAM_API_ID некорректен ("${rawId}"). Удалите из .env или укажите число с https://my.telegram.org`,
    );
  }
  if (!envHash) {
    throw new Error("TELEGRAM_API_HASH задан без TELEGRAM_API_ID (или hash пустой).");
  }
  return { apiId: envId, apiHash: envHash, source: "env" };
}

/**
 * TELEGRAM_API_ID/HASH из .env или TEST ONLY fallback (tdesktop docs).
 * Для стабильного продакшена — свои ключи с https://my.telegram.org
 */
export function resolveTelegramAppCredentials(): TelegramAppCredentials {
  const fromEnv = readEnvTelegramAppCredentials();
  if (fromEnv) return fromEnv;

  if (!defaultCredentialsWarned) {
    defaultCredentialsWarned = true;
    console.warn(
      "TELEGRAM_API_ID/HASH не заданы — TEST ONLY api_id из документации Telegram Desktop (ограничен). " +
        "При API_ID_INVALID задайте свои ключи: https://my.telegram.org → API development tools.",
    );
  }

  return {
    apiId: TELEGRAM_TEST_API_ID,
    apiHash: TELEGRAM_TEST_API_HASH,
    source: "telegram_test_default",
  };
}

/** Подсказка при auth.SendCode → API_ID_INVALID. */
export function formatTelegramApiIdInvalidHelp(source: TelegramAppCredentials["source"]): string {
  const base =
    "API_ID_INVALID: Telegram отклонил api_id/api_hash.\n" +
    "1) Удалите из .env неверные TELEGRAM_API_ID / TELEGRAM_API_HASH (если есть).\n" +
    "2) Создайте приложение: https://my.telegram.org → API development tools.\n" +
    "3) Пропишите в корневой .env оба значения и повторите deploy.";
  if (source === "env") {
    return `${base}\nСейчас используются ключи из .env — проверьте, что id и hash с одной записи на my.telegram.org.`;
  }
  return `${base}\nСейчас TEST ONLY fallback (api_id ${TELEGRAM_TEST_API_ID}) — для вашего номера нужны свои ключи.`;
}

/** Для портов ingest / session (без поля source). */
export function toTelegramMtprotoAppCredentials(
  creds: TelegramAppCredentials,
): TelegramMtprotoAppCredentials {
  return { apiId: creds.apiId, apiHash: creds.apiHash };
}
