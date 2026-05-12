import type {
  DomainEvent,
  EventLocation,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IPlaceCacheRepository,
  RawMessage,
} from "@radar/shared";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import type { GeoValidationContext } from "../parsing/geoValidationService.js";
import type { ParsePipelineService } from "../parsing/parsePipelineService.js";
import { buildDomainEvent } from "./domainEventFactory.js";

type EnricherProvider = "dadata" | "nominatim" | "llm";

function toProviderHint(
  provider: EnricherProvider | undefined,
): GeoValidationContext["providerHint"] | undefined {
  if (!provider) return undefined;
  return provider;
}

function toPrimaryProvider(providersTried: string[]): EnricherProvider | undefined {
  const provider = providersTried[0];
  if (provider === "dadata" || provider === "nominatim" || provider === "llm") {
    return provider;
  }
  return undefined;
}

function buildEnricherTelemetry(
  rawMessageId: string,
  enrich: { invoked: boolean; cacheHit: boolean },
  primaryProvider: EnricherProvider | undefined,
  hasLocationCandidates: boolean,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const provider = primaryProvider ?? "unknown";

  if (enrich.invoked) {
    events.push(
      buildDomainEvent({
        type: "EnricherInvoked",
        aggregateType: "raw_message",
        aggregateId: rawMessageId,
        payload: { provider },
      }),
    );
  }

  if (enrich.cacheHit) {
    events.push(
      buildDomainEvent({
        type: "EnricherCacheHit",
        aggregateType: "raw_message",
        aggregateId: rawMessageId,
        payload: { provider },
      }),
    );
  }

  if (!hasLocationCandidates) {
    events.push(
      buildDomainEvent({
        type: "EnricherFailed",
        aggregateType: "raw_message",
        aggregateId: rawMessageId,
        payload: { reason: "no_location_candidates" },
      }),
    );
  }

  return events;
}

export class ParseRawMessageHandler {
  constructor(
    private readonly pipeline: ParsePipelineService,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly validation: GeoValidationService,
    private readonly placeCache: IPlaceCacheRepository,
    private readonly events: IEventPublisher,
  ) {}

  private async validateLocations(
    rawText: string,
    locations: EventLocation[],
    primaryProvider: EnricherProvider | undefined,
  ) {
    const validatedLocations = [];
    for (const location of locations) {
      const validated = await this.validation.validate(rawText, location, {
        providerHint: toProviderHint(primaryProvider),
      });
      if (validated.location) {
        validatedLocations.push(validated.location);
      }
    }
    return validatedLocations;
  }

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

    const enrich = pipelineResult.report.enrich ?? {
      invoked: false,
      cacheHit: false,
      providersTried: [] as string[],
    };
    const primaryProvider = toPrimaryProvider(enrich.providersTried);
    const validatedLocations = await this.validateLocations(
      raw.rawText,
      pipelineResult.locations,
      primaryProvider,
    );

    const parsed = {
      ...pipelineResult.parsedEvent,
      rawMessageId: raw.hash,
      postedAt: raw.postedAt,
      locations: validatedLocations,
    };

    const telemetryEvents = buildEnricherTelemetry(
      raw.hash,
      enrich,
      primaryProvider,
      pipelineResult.locations.length > 0,
    );
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
