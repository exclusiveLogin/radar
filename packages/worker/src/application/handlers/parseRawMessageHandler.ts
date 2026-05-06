import type {
  DomainEvent,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IEventClassifier,
  IPlaceCacheRepository,
  RawMessage,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import type { LocationResolutionService } from "../parsing/locationResolutionService.js";

export class ParseRawMessageHandler {
  constructor(
    private readonly classifier: IEventClassifier,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly resolution: LocationResolutionService,
    private readonly validation: GeoValidationService,
    private readonly placeCache: IPlaceCacheRepository,
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

    const resolved = await this.resolution.resolve(raw.rawText);
    const validatedLocations = [];
    for (const location of resolved.locations) {
      const validated = await this.validation.validate(raw.rawText, location);
      if (validated.location) {
        validatedLocations.push(validated.location);
      }
    }
    parsed.locations = validatedLocations;

    if (resolved.diagnostics.invoked) {
      const event: DomainEvent = {
        id: randomUUID(),
        type: "EnricherInvoked",
        version: 1,
        occurredAt: new Date().toISOString(),
        aggregateType: "raw_message",
        aggregateId: raw.hash,
        payload: {
          provider: resolved.diagnostics.provider ?? "unknown",
        },
      };
      await this.events.publish([event]);
    }

    if (resolved.diagnostics.cacheHit) {
      await this.events.publish([
        {
          id: randomUUID(),
          type: "EnricherCacheHit",
          version: 1,
          occurredAt: new Date().toISOString(),
          aggregateType: "raw_message",
          aggregateId: raw.hash,
          payload: {
            provider: resolved.diagnostics.provider ?? "unknown",
          },
        },
      ]);
    }

    if (resolved.locations.length === 0) {
      await this.events.publish([
        {
          id: randomUUID(),
          type: "EnricherFailed",
          version: 1,
          occurredAt: new Date().toISOString(),
          aggregateType: "raw_message",
          aggregateId: raw.hash,
          payload: {
            reason: "no_location_candidates",
          },
        },
      ]);
    }

    if (resolved.diagnostics.provider) {
      await this.placeCache.put(
        raw.rawText.toLowerCase().trim(),
        resolved.diagnostics.provider,
        {
          sourceText: raw.rawText,
          resolvedLocations: resolved.locations,
        },
        {
          validator: "rule",
          validatedAt: new Date().toISOString(),
        },
      );
    }

    const persisted = await this.parsedEvents.upsert(parsed);
    await this.eventLocations.replaceForParsedEvent(
      persisted.id,
      parsed.locations,
    );

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
    await this.events.publish([success]);
  }
}
