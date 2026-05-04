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

  const envString = process.env.TELEGRAM_STRING_SESSION?.trim();
  const sessionFile = resolveSessionFilePath(repoRoot);

  let sessionData = "";
  if (envString) {
    sessionData = envString;
    console.log("Используется TELEGRAM_STRING_SESSION из окружения.");
  } else if (fs.existsSync(sessionFile)) {
    sessionData = fs.readFileSync(sessionFile, "utf8").trim();
    console.log(`Используется файловая сессия: ${sessionFile}`);
  }

  const session = new StringSession(sessionData);
  const client = new TelegramClient(
    session,
    credentials.apiId,
    credentials.apiHash,
    { connectionRetries: 5 },
  );

  await client.connect();

  try {
    if (!(await client.isUserAuthorized())) {
      console.log(
        "Сессия не авторизована — интерактивный вход (запускайте в терминале с TTY).",
      );
      await client.start({
        phoneNumber: async () =>
          ask("Телефон (с +, например +79990001122): "),
        password: async () => ask("Пароль 2FA (если нет — Enter): "),
        phoneCode: async () => ask("Код из Telegram: "),
        onError: (err) => console.error(err),
      });
    }

    const me = await client.getMe();
    console.log(
      "Подключено. Пользователь:",
      me.username ? `@${me.username}` : me.id.toString(),
    );

    const saved = client.session.save();
    if (typeof saved !== "string") {
      console.warn("Не удалось получить StringSession для вывода.");
    } else {
      if (!envString) {
        fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
        fs.writeFileSync(sessionFile, saved, "utf8");
        console.log(`Файл сессии обновлён: ${sessionFile}`);
      }
      console.log("\n--- TELEGRAM_STRING_SESSION для vault ---\n");
      console.log(saved);
      console.log("\n----------------------------------------\n");
    }
  } finally {
    close();
    await client.disconnect();
  }
}
