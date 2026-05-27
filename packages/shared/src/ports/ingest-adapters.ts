import type { IngestAdapterKind, IngestMode, SourceKind } from "../schemas/ingest/ingest-domain";
import type { IngestBindingRecord, IngestProviderRecord } from "../schemas/ingest/ingest-provider";
import type { RawMessage } from "../schemas/ingest/raw-message";

/** Нормализованное сообщение от adapter ACL → RawMessage. */
export type IngestNormalizedMessage = Omit<RawMessage, "hash" | "id"> & {
  hash?: string;
  telegramExtension?: {
    chatId: string;
    messageId: string;
    editDate: string | null;
    peerType?: "channel" | "group" | "supergroup" | "user";
  };
};

export type IngestAdapterHealth = {
  ok: boolean;
  detail?: string;
};

/** MTProto api_id/api_hash процесса worker (не слоты — они в provider.credentialRefs). */
export type TelegramMtprotoAppCredentials = {
  apiId: number;
  apiHash: string;
};

export type IngestAdapterContext = {
  provider: IngestProviderRecord;
  resolveSessionSecret(slotKey: string): Promise<string>;
  resolveMtproxy?(): { ip: string; port: number; secret: string } | null;
  /** Обязателен для telegram-адаптера; задаётся в composition root. */
  telegramMtprotoApp?: TelegramMtprotoAppCredentials;
};

export type IngestMessageSink = (msg: IngestNormalizedMessage) => Promise<void>;

export interface IRawIngestAdapter {
  readonly kind: IngestAdapterKind;
  connect(ctx: IngestAdapterContext): Promise<void>;
  startDuty(bindings: IngestBindingRecord[], sink: IngestMessageSink): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<IngestAdapterHealth>;
  fetchHistoryBatch?(
    binding: IngestBindingRecord,
    params: {
      fromPostedAt?: string;
      toPostedAt?: string;
      fromExternalId?: string;
      toExternalId?: string;
      batchSize: number;
    },
    sink: IngestMessageSink,
  ): Promise<{ inserted: number; duplicates: number }>;
  /** Потоковая выкачка истории (iterMessages) с retry при FloodWait. */
  streamHistory?(
    binding: IngestBindingRecord,
    params: StreamHistoryParams,
    sink: IngestMessageSink,
  ): Promise<{ inserted: number; duplicates: number }>;
}

export type StreamHistoryParams = {
  fromPostedAt?: string;
  toPostedAt?: string;
  fromExternalId?: string;
  toExternalId?: string;
  /** Resume: Telegram message id последнего обработанного сообщения. */
  offsetId?: number;
};

export type { IngestMode, SourceKind };
