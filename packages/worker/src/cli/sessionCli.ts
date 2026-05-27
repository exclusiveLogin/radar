import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createTtyPrompter } from "../infrastructure/io/ttyPrompter.js";
import { FileSessionRuntimeStore } from "../infrastructure/sessions/fileSessionRuntimeStore.js";
import { SessionBootstrapService } from "../application/sessions/sessionBootstrapService.js";
import { SessionResolver } from "../application/sessions/sessionResolver.js";
import {
  resolveTelegramAppCredentials,
  toTelegramMtprotoAppCredentials,
} from "../infrastructure/telegram/telegramAppCredentials.js";
import { isTelegramApiIdInvalidError } from "../infrastructure/telegram/telegramAuthErrors.js";
import {
  parseLongFlagsMap,
  parsePositionalArgs,
  readStringFlag,
} from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const command = parsePositionalArgs(process.argv)[0];
  const map = parseLongFlagsMap(process.argv);
  const slotKey = readStringFlag(map, ["slot"]) ?? "tg-default-user";
  const kindRaw = readStringFlag(map, ["kind"]) ?? "mtproto_user";
  const kind = kindRaw === "bot_token" ? "bot_token" : "mtproto_user";

  const store = new FileSessionRuntimeStore();
  const resolver = new SessionResolver(store);
  const resolved = resolveTelegramAppCredentials();
  console.log(`Telegram API: api_id=${resolved.apiId} (${resolved.source})`);
  const creds = toTelegramMtprotoAppCredentials(resolved);

  if (command === "invalidate") {
    await store.invalidate(slotKey);
    console.log(`Слот ${slotKey} сброшен.`);
    return;
  }

  if (command === "probe") {
    const result = await store.probe(slotKey, creds);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  if (command === "deploy") {
    const bootstrap = new SessionBootstrapService({
      store,
      resolver,
      credentials: creds,
      credentialsSource: resolved.source,
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
  if (isTelegramApiIdInvalidError(err)) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
