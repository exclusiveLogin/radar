import type {
  SessionArtifact,
  SessionDeployRequest,
  SessionMaterial,
  SessionProbeResult,
  SessionWriteInput,
} from "../schemas/ingest/session-artifact";

export interface ISessionRuntimeStore {
  read(slotKey: string): Promise<SessionArtifact | null>;
  readSecret(slotKey: string): Promise<string | null>;
  write(slotKey: string, payload: SessionWriteInput): Promise<SessionArtifact>;
  invalidate(slotKey: string): Promise<void>;
  probe(slotKey: string, credentials: { apiId: number; apiHash: string }): Promise<SessionProbeResult>;
}

export interface ISessionBootstrapService {
  /** Интерактивный развёртывание на чистом стенде (TTY). */
  deploySlot(input: SessionDeployRequest): Promise<SessionArtifact>;
  /** Авто: read → probe → re-deploy если invalid и есть TTY. */
  ensureSlot(
    slotKey: string,
    kind: SessionDeployRequest["kind"],
    credentials: { apiId: number; apiHash: string },
  ): Promise<SessionMaterial>;
}
