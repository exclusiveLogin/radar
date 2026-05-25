import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ISessionRuntimeStore,
  SessionKind,
  SessionMaterial,
  SessionWriteInput,
} from "@radar/shared";
import { MONOREPO_ROOT } from "@repo/root";
import { FileSessionRuntimeStore } from "../../infrastructure/sessions/fileSessionRuntimeStore.js";

export const DEFAULT_MTPROTO_SLOT = "tg-default-user";

/**
 * Разрешение session material: env override → volume → legacy `.telegram/session` import.
 */
export class SessionResolver {
  constructor(
    private readonly store: ISessionRuntimeStore = new FileSessionRuntimeStore(),
    private readonly repoRoot: string = MONOREPO_ROOT,
  ) {}

  /** Секрет из env (deploy override), если задан. */
  private readEnvOverride(kind: SessionKind): string | null {
    if (kind === "mtproto_user") {
      return process.env.TELEGRAM_STRING_SESSION?.trim() || null;
    }
    return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  }

  /** One-shot импорт legacy `.telegram/session` в default slot. */
  private importLegacyMtprotoIfNeeded(slotKey: string): Promise<void> {
    if (slotKey !== DEFAULT_MTPROTO_SLOT) {
      return Promise.resolve();
    }
    return (async () => {
      const existing = await this.store.readSecret(slotKey);
      if (existing) return;

      const rel = process.env.TELEGRAM_SESSION_FILE?.trim() || ".telegram/session";
      const legacyPath = path.isAbsolute(rel) ? rel : path.join(this.repoRoot, rel);
      if (!fs.existsSync(legacyPath)) return;

      const secret = fs.readFileSync(legacyPath, "utf8").trim();
      if (!secret) return;

      const payload: SessionWriteInput = {
        kind: "mtproto_user",
        secret,
        accountHint: "legacy-import",
      };
      await this.store.write(slotKey, payload);
      console.log(`Legacy session импортирован в слот ${slotKey}.`);
    })();
  }

  async resolveMaterial(
    slotKey: string,
    kind: SessionKind,
    _credentials?: { apiId: number; apiHash: string },
  ): Promise<SessionMaterial> {
    const envSecret = this.readEnvOverride(kind);
    if (envSecret) {
      const artifact =
        (await this.store.read(slotKey)) ??
        (await this.store.write(slotKey, {
          kind,
          secret: envSecret,
          accountHint: "env-override",
        }));
      return { slotKey, kind, secret: envSecret, artifact };
    }

    await this.importLegacyMtprotoIfNeeded(slotKey);

    const artifact = await this.store.read(slotKey);
    const secret = await this.store.readSecret(slotKey);
    if (artifact && secret) {
      return { slotKey, kind: artifact.kind, secret, artifact };
    }

    throw new Error(
      `Session slot "${slotKey}" пуст. Запустите worker:session:deploy или задайте env override.`,
    );
  }

  getStore(): ISessionRuntimeStore {
    return this.store;
  }
}
