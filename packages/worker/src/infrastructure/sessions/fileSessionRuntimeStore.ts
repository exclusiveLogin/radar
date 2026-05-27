/**
 * Runtime Credentials: артефакты MTProto/bot на volume (не в git, не в БД).
 */
import { MONOREPO_ROOT } from "@repo/root";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ISessionRuntimeStore,
  SessionArtifact,
  SessionProbeResult,
  SessionWriteInput,
  TelegramMtprotoAppCredentials,
} from "@radar/shared";
import { sessionArtifactSchema } from "@radar/shared";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/StringSession.js";

const ARTIFACT_FILE = "artifact.json";
const SECRET_FILE = "secret";

/** Корень слотов — всегда от MONOREPO_ROOT, не от cwd пакета worker. */
function resolveSessionsRoot(): string {
  const fromEnv = process.env.RADAR_SESSIONS_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(MONOREPO_ROOT, fromEnv);
  }
  return path.resolve(MONOREPO_ROOT, ".radar/sessions");
}

function slotDir(root: string, slotKey: string): string {
  return path.join(root, slotKey);
}

async function chmodSecret(filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Windows может не поддерживать unix mode — не блокируем запись.
  }
}

/**
 * Файловое хранилище session-слотов на volume (artifact.json + secret).
 */
export class FileSessionRuntimeStore implements ISessionRuntimeStore {
  constructor(private readonly rootDir: string = resolveSessionsRoot()) {}

  async read(slotKey: string): Promise<SessionArtifact | null> {
    const artifactPath = path.join(slotDir(this.rootDir, slotKey), ARTIFACT_FILE);
    try {
      const raw = JSON.parse(await fs.readFile(artifactPath, "utf8")) as unknown;
      return sessionArtifactSchema.parse(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async readSecret(slotKey: string): Promise<string | null> {
    const secretPath = path.join(slotDir(this.rootDir, slotKey), SECRET_FILE);
    try {
      return (await fs.readFile(secretPath, "utf8")).trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async write(slotKey: string, payload: SessionWriteInput): Promise<SessionArtifact> {
    const dir = slotDir(this.rootDir, slotKey);
    await fs.mkdir(dir, { recursive: true });

    const artifact: SessionArtifact = {
      slotKey,
      kind: payload.kind,
      providerKey: payload.providerKey,
      authorizedAt: new Date().toISOString(),
      accountHint: payload.accountHint,
      schemaVersion: 1,
    };

    await fs.writeFile(
      path.join(dir, ARTIFACT_FILE),
      JSON.stringify(artifact, null, 2),
      "utf8",
    );
    const secretPath = path.join(dir, SECRET_FILE);
    await fs.writeFile(secretPath, payload.secret, { encoding: "utf8", mode: 0o600 });
    await chmodSecret(secretPath);

    return artifact;
  }

  async invalidate(slotKey: string): Promise<void> {
    const dir = slotDir(this.rootDir, slotKey);
    await fs.rm(dir, { recursive: true, force: true });
  }

  async probe(
    slotKey: string,
    credentials: TelegramMtprotoAppCredentials,
  ): Promise<SessionProbeResult> {
    const artifact = await this.read(slotKey);
    const secret = await this.readSecret(slotKey);
    if (!artifact || !secret) {
      return { ok: false, error: "slot_empty" };
    }

    if (artifact.kind === "bot_token") {
      try {
        const url = `https://api.telegram.org/bot${secret}/getMe`;
        const res = await fetch(url);
        const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };
        if (!body.ok) {
          return { ok: false, error: "bot_getMe_failed" };
        }
        const hint = body.result?.username ? `@${body.result.username}` : undefined;
        return { ok: true, accountHint: hint };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "bot_probe_error" };
      }
    }

    const client = new TelegramClient(
      new StringSession(secret),
      credentials.apiId,
      credentials.apiHash,
      { connectionRetries: 3 },
    );

    try {
      await client.connect();
      if (!(await client.isUserAuthorized())) {
        return { ok: false, error: "not_authorized" };
      }
      const me = await client.getMe();
      const hint = me.username ? `@${me.username}` : String(me.id);
      return { ok: true, accountHint: hint };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "mtproto_probe_error" };
    } finally {
      await client.disconnect();
    }
  }
}
