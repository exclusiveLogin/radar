import type {
  DomainEvent,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IEventClassifier,
  RawMessage,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

export class ParseRawMessageHandler {
  constructor(
    private readonly classifier: IEventClassifier,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly events: IEventPublisher,
  ) {}

  async handle(raw: RawMessage): Promise<void> {
    const classified = this.classifier.classify(raw.rawText);
    if (classified.kind !== "event") {
      const failed: DomainEvent = {
        id: randomUUID(),
        type: "MessageParseFailed",
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateType: "raw_message",
        aggregateId: raw.hash,
        payload: {
          reason: classified.reason,
          channelKey: raw.channelKey,
        },
      };
      await this.events.publish([failed]);
      return;
    }

    const parsed = {
      ...classified.event,
      rawMessageId: classified.event.rawMessageId || raw.hash,
      postedAt: raw.postedAt,
    };

    const persisted = await this.parsedEvents.upsert(parsed);
    await this.eventLocations.replaceForParsedEvent(
      persisted.id,
      parsed.locations,
    );

    const enriched: DomainEvent = {
      id: randomUUID(),
      type: "EnricherInvoked",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateType: "parsed_event",
      aggregateId: persisted.id,
      payload: {
        locationsCount: parsed.locations.length,
      },
    };
    const success: DomainEvent = {
      id: randomUUID(),
      type: "MessageParsed",
      version: 1,
      occurredAt: new Date().toISOString(),
      aggregateType: "parsed_event",
      aggregateId: persisted.id,
      payload: {
        eventType: parsed.eventType,
        severity: parsed.severity,
      },
    };
    await this.events.publish([enriched, success]);
  }
}
