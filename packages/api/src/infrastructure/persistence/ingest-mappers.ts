import type {
  BackfillJobRecord,
  IngestBindingRecord,
  IngestProviderRecord,
  RawMessage,
} from "@radar/shared";
import type { IngestBackfillJobEntity } from "../../ingest/entities/ingest-backfill-job.entity";
import type { IngestBindingEntity } from "../../ingest/entities/ingest-binding.entity";
import type { IngestProviderEntity } from "../../ingest/entities/ingest-provider.entity";
import type { RawMessageEntity } from "../../ingest/entities/raw-message.entity";
import type { ChannelEntity } from "../../ingest/entities/channel.entity";

export function toProviderRecord(row: IngestProviderEntity): IngestProviderRecord {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    adapterKind: row.adapterKind as IngestProviderRecord["adapterKind"],
    status: row.status as IngestProviderRecord["status"],
    adapterConfig: row.adapterConfig as IngestProviderRecord["adapterConfig"],
    credentialRefs: row.credentialRefs as IngestProviderRecord["credentialRefs"],
    lastError: row.lastError,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toBindingRecord(row: IngestBindingEntity): IngestBindingRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    channelId: row.channelId,
    bindingKey: row.bindingKey,
    enabled: row.enabled,
    externalTarget: row.externalTarget,
    bindingMode: row.bindingMode as IngestBindingRecord["bindingMode"],
    parseOverrides: row.parseOverrides,
    adapterBinding: row.adapterBinding,
  };
}

export function toBackfillJobRecord(row: IngestBackfillJobEntity): BackfillJobRecord {
  return {
    id: row.id,
    bindingId: row.bindingId,
    providerId: row.providerId,
    strategy: row.strategy as BackfillJobRecord["strategy"],
    params: row.params,
    status: row.status as BackfillJobRecord["status"],
    stats: row.stats,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRawMessage(row: RawMessageEntity, channel: ChannelEntity): RawMessage {
  return {
    id: row.id,
    channelKey: channel.key,
    providerKey: row.providerKey,
    sourceKind: row.sourceKind as RawMessage["sourceKind"],
    externalMessageId: row.externalMessageId,
    revisionKey: row.revisionKey,
    sourceSequence: row.sourceSequence,
    postedAt: row.postedAt.toISOString(),
    ingestMode: row.ingestMode as RawMessage["ingestMode"],
    rawText: row.rawText,
    rawPayload: row.rawPayload,
    hash: row.hash,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}
