import type {
  ISessionBootstrapService,
  ISessionRuntimeStore,
  SessionArtifact,
  SessionDeployRequest,
  SessionKind,
  SessionMaterial,
} from "@radar/shared";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";
import type { TtyPrompter } from "../../infrastructure/io/ttyPrompter.js";
import type { SessionResolver } from "./sessionResolver.js";

export type SessionBootstrapDeps = {
  store: ISessionRuntimeStore;
  resolver: SessionResolver;
  credentials: { apiId: number; apiHash: string };
  prompter: TtyPrompter;
};

/**
 * Bootstrap сессий: интерактивный deploy и ensure (read → probe → re-deploy при invalid + TTY).
 */
export class SessionBootstrapService implements ISessionBootstrapService {
  constructor(private readonly deps: SessionBootstrapDeps) {}

  async deploySlot(input: SessionDeployRequest): Promise<SessionArtifact> {
    const { store, credentials, prompter } = this.deps;
    const { ask, close } = prompter;

    if (input.kind === "bot_token") {
      const token = await ask("Bot token: ");
      if (!token) {
        throw new Error("Bot token обязателен.");
      }
      const artifact = await store.write(input.slotKey, {
        kind: "bot_token",
        secret: token,
        providerKey: input.providerKey,
      });
      const probe = await store.probe(input.slotKey, credentials);
      if (probe.accountHint) {
        await store.write(input.slotKey, {
          kind: "bot_token",
          secret: token,
          providerKey: input.providerKey,
          accountHint: probe.accountHint,
        });
      }
      close();
      return probe.accountHint
        ? (await store.read(input.slotKey))!
        : artifact;
    }

    const envSeed = process.env.TELEGRAM_STRING_SESSION?.trim() ?? "";
    const existing = await store.readSecret(input.slotKey);
    const session = new StringSession(existing ?? envSeed);
    const client = new TelegramClient(session, credentials.apiId, credentials.apiHash, {
      connectionRetries: 5,
    });

    await client.connect();
    try {
      if (!(await client.isUserAuthorized())) {
        console.log("Интерактивный MTProto login (TTY).");
        await client.start({
          phoneNumber: async () => ask("Телефон (+7999...): "),
          password: async () => ask("2FA пароль (Enter если нет): "),
          phoneCode: async () => ask("Код из Telegram: "),
          onError: (err) => console.error(err),
        });
      }

      const me = await client.getMe();
      const saved = client.session.save();
      if (typeof saved !== "string") {
        throw new Error("Не удалось сохранить StringSession.");
      }

      const artifact = await store.write(input.slotKey, {
        kind: "mtproto_user",
        secret: saved,
        providerKey: input.providerKey,
        accountHint: me.username ? `@${me.username}` : String(me.id),
      });
      console.log(`Слот ${input.slotKey} развёрнут (${artifact.accountHint ?? "ok"}).`);
      return artifact;
    } finally {
      close();
      await client.disconnect();
    }
  }

  async ensureSlot(
    slotKey: string,
    kind: SessionKind,
    credentials: { apiId: number; apiHash: string },
  ): Promise<SessionMaterial> {
    const { store, resolver } = this.deps;

    try {
      const material = await resolver.resolveMaterial(slotKey, kind, credentials);
      const probe = await store.probe(slotKey, credentials);
      if (probe.ok) {
        return material;
      }
      console.warn(`Probe failed для ${slotKey}: ${probe.error ?? "unknown"}`);
    } catch {
      // пустой слот — deploy ниже
    }

    const hasTty = process.stdin.isTTY && process.stdout.isTTY;
    if (!hasTty) {
      throw new Error(
        `Session slot "${slotKey}" invalid/empty и нет TTY для re-deploy. Запустите worker:session:deploy.`,
      );
    }

    await store.invalidate(slotKey);
    const artifact = await this.deploySlot({ slotKey, kind });
    const secret = (await store.readSecret(slotKey))!;
    return { slotKey, kind, secret, artifact };
  }
}
