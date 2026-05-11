import type {
  DomainEvent,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IPlaceCacheRepository,
  RawMessage,
} from "@radar/shared";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import type { ParsePipelineService } from "../parsing/parsePipelineService.js";
import { buildDomainEvent } from "./domainEventFactory.js";

export class ParseRawMessageHandler {
  constructor(
    private readonly pipeline: ParsePipelineService,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly validation: GeoValidationService,
    private readonly placeCache: IPlaceCacheRepository,
    private readonly events: IEventPublisher,
  ) {}

  async handle(raw: RawMessage): Promise<void> {
    const pipelineResult = await this.pipeline.execute({
      rawText: raw.rawText,
      postedAt: raw.postedAt,
      channelKey: raw.channelKey,
      rawMessageId: raw.hash,
    });

    if (!pipelineResult.parsedEvent) {
      const failed = buildDomainEvent({
        type: "MessageParseFailed",
        aggregateType: "raw_message",
        aggregateId: raw.hash,
        payload: {
          reason: pipelineResult.report.classification.reason ?? "not_event",
          channelKey: raw.channelKey,
        },
      });
      await this.events.publish([failed]);
      return;
    }

    const validatedLocations = [];
    for (const location of pipelineResult.locations) {
      const validated = await this.validation.validate(raw.rawText, location);
      if (validated.location) {
        validatedLocations.push(validated.location);
      }
    }

    const parsed = {
      ...pipelineResult.parsedEvent,
      rawMessageId: raw.hash,
      postedAt: raw.postedAt,
      locations: validatedLocations,
    };

    const enrich = pipelineResult.report.enrich ?? { invoked: false, cacheHit: false, providersTried: [] as string[] };
    const primaryProvider = enrich.providersTried[0] as "dadata" | "nominatim" | "llm" | undefined;
    const telemetryEvents: DomainEvent[] = [];

    if (enrich.invoked) {
      telemetryEvents.push(
        buildDomainEvent({
          type: "EnricherInvoked",
          aggregateType: "raw_message",
          aggregateId: raw.hash,
          payload: {
            provider: primaryProvider ?? "unknown",
          },
        }),
      );
    }

    if (enrich.cacheHit) {
      telemetryEvents.push(
        buildDomainEvent({
          type: "EnricherCacheHit",
          aggregateType: "raw_message",
          aggregateId: raw.hash,
          payload: {
            provider: primaryProvider ?? "unknown",
          },
        }),
      );
    }

    if (pipelineResult.locations.length === 0) {
      telemetryEvents.push(
        buildDomainEvent({
          type: "EnricherFailed",
          aggregateType: "raw_message",
          aggregateId: raw.hash,
          payload: {
            reason: "no_location_candidates",
          },
        }),
      );
    }

    if (telemetryEvents.length > 0) {
      await this.events.publish(telemetryEvents);
    }

    if (primaryProvider) {
      await this.placeCache.put(
        raw.rawText.toLowerCase().trim(),
        primaryProvider,
        {
          sourceText: raw.rawText,
          resolvedLocations: pipelineResult.locations,
        },
        {
          validator: "rule",
          validatedAt: new Date().toISOString(),
        },
      );
    }

    const persisted = await this.parsedEvents.upsert(parsed);
    await this.eventLocations.replaceForParsedEvent(persisted.id, parsed.locations);

    const success = buildDomainEvent({
      type: "MessageParsed",
      aggregateType: "parsed_event",
      aggregateId: persisted.id,
      payload: {
        eventType: parsed.eventType,
        severity: parsed.severity,
      },
    });
    await this.events.publish([success]);
  }
}
