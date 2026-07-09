import type {
  DomainEvent,
  IIngestCursorRepository,
  IRawMessageRepository,
  RawMessage,
  RawMessageTelegramExtension,
} from "@radar/shared";
import { ingestMessageHash } from "@radar/shared";
import { randomUUID } from "node:crypto";
import { workerRuntimeStatus } from "../workerRuntimeStatus.js";
import {
  publishIngestDomainEvent,
  type IngestEventPublisher,
} from "./ingestEventPublishMode.js";

/**
 * Use case: upsert сырого сообщения, duplicate-safe events, live cursor advance.
 * Публикация: in-process bus и/или event_outbox outbox (по роли worker).
 * @see ../../../../../docs/domain/how-it-works.md#ingest-flow
 * @see ../../../../../docs/domain/contexts/ingest.md
 * @see ../../../../../docs/domain/aggregates.md
 */
export class IngestRawMessageHandler {
  constructor(
    private readonly rawMessages: IRawMessageRepository,
    private readonly events: IngestEventPublisher,
    private readonly cursors?: IIngestCursorRepository,
  ) {}

  async handle(
    raw: RawMessage,
    extension?: RawMessageTelegramExtension,
  ): Promise<{ inserted: boolean; rawMessageId: string }> {
    const hash =
      raw.hash ||
      ingestMessageHash({
        channelKey: raw.channelKey,
        providerKey: raw.providerKey,
        sourceKind: raw.sourceKind,
        externalMessageId: raw.externalMessageId,
        revisionKey: raw.revisionKey ?? null,
        postedAt: raw.postedAt,
        rawText: raw.rawText,
        rawPayload: raw.rawPayload,
      });

    const normalized: RawMessage = { ...raw, hash };
    const result = await this.rawMessages.upsert(normalized, extension);

    if (result.inserted && this.cursors && normalized.ingestMode === "live") {
      await this.cursors.advanceLive({
        channelKey: normalized.channelKey,
        providerKey: normalized.providerKey,
        externalMessageId: normalized.externalMessageId,
        postedAt: normalized.postedAt,
        sourceSequence: normalized.sourceSequence ?? null,
        ingestMode: "live",
      });
    }

    const event: DomainEvent = {
      id: randomUUID(),
      type: result.inserted ? "RawMessageIngested" : "RawMessageDuplicate",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateType: "raw_message",
      aggregateId: result.id,
      payload: {
        channelKey: normalized.channelKey,
        providerKey: normalized.providerKey,
        externalMessageId: normalized.externalMessageId,
        hash: normalized.hash,
        ingestMode: normalized.ingestMode,
      },
    };
    await publishIngestDomainEvent(this.events, event);
    workerRuntimeStatus.recordIngest({
      ingestMode: normalized.ingestMode ?? "live",
      inserted: result.inserted,
      channelKey: normalized.channelKey,
    });
    return { inserted: result.inserted, rawMessageId: result.id };
  }
}
