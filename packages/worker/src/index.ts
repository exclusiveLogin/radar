import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../../..");

function loadEnv(): void {
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
}

loadEnv();

function defaultSessionPath(): string {
  const rel = process.env.TELEGRAM_SESSION_FILE?.trim() || ".telegram/session";
  return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
}

function createPrompter(): {
  ask: (q: string) => Promise<string>;
  close: () => void;
} {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask: (q) =>
      new Promise((resolve) => {
        rl.question(q, (answer) => resolve(answer.trim()));
      }),
    close: () => rl.close(),
  };
}

async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() ?? "";
  if (!apiId || !apiHash) {
    console.error(
      "Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH (см. .env.example; значения с https://my.telegram.org).",
    );
    process.exit(1);
  }

  const envString = process.env.TELEGRAM_STRING_SESSION?.trim();
  const sessionFile = defaultSessionPath();

  let sessionData = "";
  if (envString) {
    sessionData = envString;
    console.log("Используется TELEGRAM_STRING_SESSION из окружения.");
  } else if (fs.existsSync(sessionFile)) {
    sessionData = fs.readFileSync(sessionFile, "utf8").trim();
    console.log(`Используется файловая сессия: ${sessionFile}`);
  }

  const session = new StringSession(sessionData);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();

  const { ask, close } = createPrompter();

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
