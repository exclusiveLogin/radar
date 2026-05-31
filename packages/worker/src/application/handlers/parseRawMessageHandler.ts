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
import type { ParseWorkerPool } from "../parsing/parseWorkerPool.js";
import { PARSER_VERSION } from "../../domain/parsing/version.js";
import { buildDomainEvent } from "./domainEventFactory.js";

type EnricherProvider = "dadata" | "nominatim" | "llm";

/** Нормализация имени для сопоставления локации с LLM-нодой. */
function normalizeNodeName(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").trim();
}

/** Индекс LLM-сигналов (confidence/reason) по нормализованному имени места. */
function buildLlmSignalIndex(
  artifact: { llm?: { nodes: Array<{ name: string; confidence?: number; reason?: string }> } } | undefined,
): Map<string, { confidence?: number; reason?: string }> {
  const index = new Map<string, { confidence?: number; reason?: string }>();
  for (const node of artifact?.llm?.nodes ?? []) {
    index.set(normalizeNodeName(node.name), {
      confidence: node.confidence,
      reason: node.reason,
    });
  }
  return index;
}

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

/**
 * Use case: сырой текст → classify/geo pipeline → parsed_event.
 * Инвариант: `rawMessageId` — uuid строки в БД (не content hash).
 * @see ../../../../../docs/domain/how-it-works.md#parse-flow
 * @see ../../../../../docs/domain/aggregates.md
 * @see ../../../../../docs/domain/contexts/geo-place.md
 */
export class ParseRawMessageHandler {
  constructor(
    private readonly pipeline: ParsePipelineService,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly validation: GeoValidationService,
    private readonly placeCache: IPlaceCacheRepository,
    private readonly events: IEventPublisher,
    /** Опционально: classify/geo в worker_threads (не блокирует event loop). */
    private readonly parseWorkerPool?: ParseWorkerPool,
  ) {}

  private async runPipeline(input: {
    rawText: string;
    postedAt: string;
    channelKey: string;
    rawMessageId: string;
  }) {
    if (this.parseWorkerPool) {
      return this.parseWorkerPool.execute(input);
    }
    return this.pipeline.execute(input);
  }

  private async validateLocations(
    rawText: string,
    locations: EventLocation[],
    primaryProvider: EnricherProvider | undefined,
    llmSignals: Map<string, { confidence?: number; reason?: string }>,
  ) {
    const validatedLocations = [];
    for (const location of locations) {
      const signal =
        location.source === "llm" && location.placeName
          ? llmSignals.get(normalizeNodeName(location.placeName))
          : undefined;
      const validated = await this.validation.validate(rawText, location, {
        providerHint: toProviderHint(primaryProvider),
        confidence: signal?.confidence,
        reason: signal?.reason,
      });
      if (validated.location) {
        validatedLocations.push(validated.location);
      }
    }
    return validatedLocations;
  }

  async handle(raw: RawMessage): Promise<void> {
    if (!raw.id) {
      throw new Error("ParseRawMessageHandler: raw.id (uuid) обязателен");
    }
    const rawMessageId = raw.id;
    let pipelineResult;
    try {
      pipelineResult = await this.runPipeline({
        rawText: raw.rawText,
        postedAt: raw.postedAt,
        channelKey: raw.channelKey,
        rawMessageId,
      });
    } catch (err) {
      // Реальная ошибка парсера: фиксируем технический след (parse_attempts) и пробрасываем дальше.
      const message = err instanceof Error ? err.message : String(err);
      await this.events.publish([
        buildDomainEvent({
          type: "MessageParseFailed",
          aggregateType: "raw_message",
          aggregateId: rawMessageId,
          payload: {
            reason: `error:${message}`,
            channelKey: raw.channelKey,
            rawMessageId,
            parserVersion: PARSER_VERSION,
            outcome: "failed",
            errors: { message },
          },
        }),
      ]);
      throw err;
    }

    if (!pipelineResult.parsedEvent) {
      // Не ошибка, а «не событие» (noise/meta): помечаем как skipped.
      const failed = buildDomainEvent({
        type: "MessageParseFailed",
        aggregateType: "raw_message",
        aggregateId: rawMessageId,
        payload: {
          reason: pipelineResult.report.classification.reason ?? "not_event",
          channelKey: raw.channelKey,
          rawMessageId,
          parserVersion: PARSER_VERSION,
          outcome: "skipped",
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
    const llmSignals = buildLlmSignalIndex(pipelineResult.artifact);
    const validatedLocations = await this.validateLocations(
      raw.rawText,
      pipelineResult.locations,
      primaryProvider,
      llmSignals,
    );

    const parsed = {
      ...pipelineResult.parsedEvent,
      rawMessageId,
      postedAt: raw.postedAt,
      locations: validatedLocations,
    };

    const telemetryEvents = buildEnricherTelemetry(
      rawMessageId,
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
        rawMessageId,
        channelKey: raw.channelKey,
        parserVersion: PARSER_VERSION,
        eventType: parsed.eventType,
        severity: parsed.severity,
        direction: parsed.direction,
        postedAt: parsed.postedAt,
        // Срез локаций для проекции состояния регионов (без тяжёлых полей).
        locations: parsed.locations.map((location) => ({
          regionId: location.regionId,
          regionCode: location.regionCode,
          placeId: location.placeId,
          precision: location.precision,
        })),
      },
    });
    await this.events.publish([success]);
  }
}
