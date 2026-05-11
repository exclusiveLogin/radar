import * as fs from "node:fs";
import * as path from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import type { TtyPrompter } from "../io/ttyPrompter.js";
import { resolveSessionFilePath } from "./sessionPaths.js";

export type TelegramCredentials = {
  apiId: number;
  apiHash: string;
};

/** Resolves seed string session from env first, then from local session file. */
function resolveSeedSession(sessionFile: string): {
  sessionData: string;
  fromEnv: boolean;
} {
  const envString = process.env.TELEGRAM_STRING_SESSION?.trim();
  if (envString) {
    console.log("Используется TELEGRAM_STRING_SESSION из окружения.");
    return { sessionData: envString, fromEnv: true };
  }
  if (fs.existsSync(sessionFile)) {
    const sessionData = fs.readFileSync(sessionFile, "utf8").trim();
    console.log(`Используется файловая сессия: ${sessionFile}`);
    return { sessionData, fromEnv: false };
  }
  return { sessionData: "", fromEnv: false };
}

/** Ensures user authorization, falling back to interactive login flow. */
async function ensureAuthorization(
  client: TelegramClient,
  ask: TtyPrompter["ask"],
): Promise<void> {
  if (await client.isUserAuthorized()) {
    return;
  }
  console.log(
    "Сессия не авторизована — интерактивный вход (запускайте в терминале с TTY).",
  );
  await client.start({
    phoneNumber: async () => ask("Телефон (с +, например +79990001122): "),
    password: async () => ask("Пароль 2FA (если нет — Enter): "),
    phoneCode: async () => ask("Код из Telegram: "),
    onError: (err) => console.error(err),
  });
}

/** Prints current session and persists it to file when env session is absent. */
function printAndPersistSession(options: {
  client: TelegramClient;
  sessionFile: string;
  fromEnv: boolean;
}): void {
  const saved = options.client.session.save();
  if (typeof saved !== "string") {
    console.warn("Не удалось получить StringSession для вывода.");
    return;
  }

  if (!options.fromEnv) {
    fs.mkdirSync(path.dirname(options.sessionFile), { recursive: true });
    fs.writeFileSync(options.sessionFile, saved, "utf8");
    console.log(`Файл сессии обновлён: ${options.sessionFile}`);
  }
  console.log("\n--- TELEGRAM_STRING_SESSION для vault ---\n");
  console.log(saved);
  console.log("\n----------------------------------------\n");
}

/**
 * Подключение GramJS, интерактивный вход при необходимости, сохранение сессии.
 * Инфраструктурный слой: без доменной логики парсинга.
 */
export async function runTelegramUserSessionBootstrap(options: {
  repoRoot: string;
  credentials: TelegramCredentials;
  prompter: TtyPrompter;
}): Promise<void> {
  const { repoRoot, credentials, prompter } = options;
  const { ask, close } = prompter;
  const sessionFile = resolveSessionFilePath(repoRoot);
  const seedSession = resolveSeedSession(sessionFile);

  const session = new StringSession(seedSession.sessionData);
  const client = new TelegramClient(
    session,
    credentials.apiId,
    credentials.apiHash,
    { connectionRetries: 5 },
  );

  await client.connect();

  try {
    await ensureAuthorization(client, ask);

    const me = await client.getMe();
    console.log(
      "Подключено. Пользователь:",
      me.username ? `@${me.username}` : me.id.toString(),
    );

    printAndPersistSession({
      client,
      sessionFile,
      fromEnv: seedSession.fromEnv,
    });
  } finally {
    close();
    await client.disconnect();
  }
}
