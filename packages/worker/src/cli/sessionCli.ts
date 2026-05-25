import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createTtyPrompter } from "../infrastructure/io/ttyPrompter.js";
import { FileSessionRuntimeStore } from "../infrastructure/sessions/fileSessionRuntimeStore.js";
import { SessionBootstrapService } from "../application/sessions/sessionBootstrapService.js";
import { SessionResolver } from "../application/sessions/sessionResolver.js";
import {
  parseLongFlagsMap,
  parsePositionalArgs,
  readStringFlag,
} from "./workerCliArgs.js";

function readTelegramCredentials():
  | { ok: true; apiId: number; apiHash: string }
  | { ok: false } {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() ?? "";
  if (!apiId || !apiHash) {
    return { ok: false };
  }
  return { ok: true, apiId, apiHash };
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const command = parsePositionalArgs(process.argv)[0];
  const map = parseLongFlagsMap(process.argv);
  const slotKey = readStringFlag(map, ["slot"]) ?? "tg-default-user";
  const kindRaw = readStringFlag(map, ["kind"]) ?? "mtproto_user";
  const kind = kindRaw === "bot_token" ? "bot_token" : "mtproto_user";

  const store = new FileSessionRuntimeStore();
  const resolver = new SessionResolver(store, MONOREPO_ROOT);
  const creds = readTelegramCredentials();

  if (command === "invalidate") {
    await store.invalidate(slotKey);
    console.log(`Слот ${slotKey} сброшен.`);
    return;
  }

  if (command === "probe") {
    if (!creds.ok) {
      console.error("Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH.");
      process.exit(1);
    }
    const result = await store.probe(slotKey, creds);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "deploy") {
    if (!creds.ok) {
      console.error("Нужны TELEGRAM_API_ID и TELEGRAM_API_HASH.");
      process.exit(1);
    }
    const bootstrap = new SessionBootstrapService({
      store,
      resolver,
      credentials: creds,
      prompter: createTtyPrompter(),
    });
    const artifact = await bootstrap.deploySlot({
      slotKey,
      kind,
      providerKey: readStringFlag(map, ["provider-key", "providerKey"]),
    });
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  console.error("Usage: sessionCli <deploy|probe|invalidate> --slot=<key> [--kind=mtproto_user|bot_token]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
