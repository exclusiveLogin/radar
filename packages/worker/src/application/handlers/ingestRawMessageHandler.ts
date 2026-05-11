import type { DomainEvent, IEventPublisher, IRawMessageRepository, RawMessage } from "@radar/shared";
import { randomUUID } from "node:crypto";

export class IngestRawMessageHandler {
  constructor(
    private readonly rawMessages: IRawMessageRepository,
    private readonly events: IEventPublisher,
  ) {}async handle(raw: RawMessage): Promise<{ inserted: boolean; rawMessageId: string }> {
    const result = await this.rawMessages.upsert(raw);
    const event: DomainEvent = {
      id: randomUUID(),
      type: result.inserted ? "RawMessageIngested" : "RawMessageDuplicate",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateType: "raw_message",
      aggregateId: result.id,
      payload: {
        channelKey: raw.channelKey,
        telegramMessageId: raw.telegramMessageId,
        hash: raw.hash,
      },
    };
    await this.events.publish([event]);
    return { inserted: result.inserted, rawMessageId: result.id };
  }
}
