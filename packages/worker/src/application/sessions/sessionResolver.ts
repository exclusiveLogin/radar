import type {
  ISessionRuntimeStore,
  SessionKind,
  SessionMaterial,
} from "@radar/shared";
import { FileSessionRuntimeStore } from "../../infrastructure/sessions/fileSessionRuntimeStore.js";

export const DEFAULT_MTPROTO_SLOT = "tg-default-user";

/**
 * Разрешение session material только из volume-слотов (`RADAR_SESSIONS_DIR`).
 * Секреты не читаются из `.env` — deploy через `worker:session:deploy`.
 */
export class SessionResolver {
  constructor(private readonly store: ISessionRuntimeStore = new FileSessionRuntimeStore()) {}

  async resolveMaterial(slotKey: string, kind: SessionKind): Promise<SessionMaterial> {
    const artifact = await this.store.read(slotKey);
    const secret = await this.store.readSecret(slotKey);
    if (artifact && secret) {
      return { slotKey, kind: artifact.kind, secret, artifact };
    }

    throw new Error(
      `Session slot "${slotKey}" пуст. Запустите: npm run worker:session:deploy -- --slot ${slotKey} --kind ${kind}`,
    );
  }

  getStore(): ISessionRuntimeStore {
    return this.store;
  }
}
