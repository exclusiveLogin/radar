import type {
  DomainEvent,
  EventLocation,
  EventEvidenceRecord,
  GeoEnrichmentArtifact,
  IEventEvidenceRepository,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  IPlaceRepository,
  RawMessage,
} from "@radar/shared";
import type { GeoValidationService } from "../parsing/geoValidationService.js";
import type { GeoValidationContext } from "../parsing/geoValidationService.js";
import type { ParsePipelineService } from "../parsing/parsePipelineService.js";
import type { ParseWorkerPool } from "../parsing/parseWorkerPool.js";
import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";
import {
  buildGeoEnrichmentState,
  loadGeoEnrichmentState,
  withGeoEnrichmentExtras,
} from "../geo-pipeline/geoEnrichmentState.js";
import {
  isLlmExplicitDeactivate,
  mergeEventLocations,
} from "../../domain/geo/mergeEventLocations.js";
import { resolveParsedEventActivation } from "../../domain/parsing/resolveParsedEventActivation.js";
import { PARSER_VERSION } from "../../domain/parsing/version.js";
import { buildDomainEvent } from "./domainEventFactory.js";
import { randomUUID } from "node:crypto";
import { isPlaceCentricGeoEnabled } from "../../infrastructure/config/placeCentricFeatureFlag.js";

type EnricherProvider = "dadata" | "nominatim" | "llm";

/** Контекст фазы ingestParse для baseline/enrich merge. */
export type ParsePhaseContext = {
  phaseId?: string;
  phaseMode?: GeoPipelinePhaseMode;
};

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

/** Обогащает локации action/status для persist в event_locations. */
function toFactLocations(
  locations: EventLocation[],
  input: {
    eventType: string;
    postedAt: string;
    channelKey: string;
    isClearingEvent: boolean;
  },
): EventLocation[] {
  return locations.map((location) => ({
    ...location,
    entityKind: location.entityKind ?? (location.placeId ? "place" : "region"),
    authorChannelKey: input.channelKey,
    action: input.isClearingEvent ? "clear" : "raise",
    statusCode: location.statusCode ?? input.eventType,
    occurredAt: input.postedAt,
  }));
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
    private readonly eventEvidence: IEventEvidenceRepository,
    private readonly places: IPlaceRepository,
    private readonly validation: GeoValidationService,
    private readonly events: IEventPublisher,
    /** Опционально: classify/geo в worker_threads (не блокирует event loop). */
    private readonly parseWorkerPool?: ParseWorkerPool,
    private readonly phaseContext: ParsePhaseContext = { phaseMode: "baseline" },
  ) {}

  private get phaseMode(): GeoPipelinePhaseMode {
    return this.phaseContext.phaseMode ?? "baseline";
  }

  private async runPipeline(input: {
    rawText: string;
    postedAt: string;
    channelKey: string;
    rawMessageId: string;
    initialArtifact?: GeoEnrichmentArtifact;
    priorValidatedLocations?: EventLocation[];
  }) {
    const geoContext = {
      initialArtifact: input.initialArtifact,
      priorValidatedLocations: input.priorValidatedLocations,
      phaseMode: this.phaseMode,
    };
    const payload = {
      rawText: input.rawText,
      postedAt: input.postedAt,
      channelKey: input.channelKey,
      rawMessageId: input.rawMessageId,
      geoContext,
    };
    if (this.parseWorkerPool) {
      return this.parseWorkerPool.execute(payload);
    }
    return this.pipeline.execute(payload);
  }

  private async validateLocations(
    rawText: string,
    locations: EventLocation[],
    primaryProvider: EnricherProvider | undefined,
    llmSignals: Map<string, { confidence?: number; reason?: string }>,
  ) {
    const placeLikeCount = locations.filter(
      (loc) =>
        loc.placeName
        && loc.entityKind !== "region"
        && loc.precision !== "region",
    ).length;
    const multiPlaceContext = placeLikeCount > 1;

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
        multiPlaceContext,
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

    const priorState =
      this.phaseMode === "enrich"
        ? await loadGeoEnrichmentState({
            rawMessageId,
            parsedEvents: this.parsedEvents,
            eventLocations: this.eventLocations,
          })
        : null;

    let pipelineResult;
    try {
      pipelineResult = await this.runPipeline({
        rawText: raw.rawText,
        postedAt: raw.postedAt,
        channelKey: raw.channelKey,
        rawMessageId,
        initialArtifact: priorState?.artifact,
        priorValidatedLocations: priorState?.priorLocations,
      });
    } catch (err) {
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

    const eventCategory = pipelineResult.artifact?.llm?.eventCategory;
    const eventSubject =
      pipelineResult.artifact?.llm?.eventSubject ?? pipelineResult.parsedEvent.eventSubject;
    const activation = resolveParsedEventActivation(pipelineResult.artifact);
    const priorLocations = priorState?.priorLocations ?? [];

    const parsed = {
      ...pipelineResult.parsedEvent,
      rawMessageId,
      postedAt: raw.postedAt,
      locations: validatedLocations,
      isActive: activation.isActive,
      inactiveReason: activation.inactiveReason,
      extras: {
        ...pipelineResult.parsedEvent.extras,
        ...(eventCategory ? { eventCategory } : {}),
      },
    };

    const geoState = buildGeoEnrichmentState({
      artifact: pipelineResult.artifact ?? {},
      validatedLocations: [],
      phaseId: this.phaseContext.phaseId,
    });

    const telemetryEvents = buildEnricherTelemetry(
      rawMessageId,
      enrich,
      primaryProvider,
      pipelineResult.locations.length > 0,
    );
    if (telemetryEvents.length > 0) {
      await this.events.publish(telemetryEvents);
    }

    const isClearingEvent = !activation.isActive || parsed.eventType === "cleared";
    const factInput = {
      eventType: parsed.eventType,
      postedAt: parsed.postedAt,
      channelKey: raw.channelKey,
      isClearingEvent,
    };

    let factLocations = toFactLocations(validatedLocations, factInput);

    if (this.phaseMode === "enrich") {
      const priorFacts = toFactLocations(priorLocations, factInput);
      if (isLlmExplicitDeactivate(pipelineResult.artifact)) {
        factLocations = toFactLocations(validatedLocations, factInput);
      } else if (validatedLocations.length === 0) {
        factLocations = priorFacts;
      } else {
        factLocations = mergeEventLocations(
          priorFacts,
          toFactLocations(validatedLocations, factInput),
        );
      }
    }

    geoState.validatedLocations = factLocations;
    parsed.extras = withGeoEnrichmentExtras(parsed.extras, geoState);

    const persisted = await this.parsedEvents.upsert(parsed);

    let projectionLocations: EventLocation[] = factLocations;
    if (activation.isActive) {
      await this.eventLocations.replaceForParsedEvent(persisted.id, factLocations);
    } else {
      projectionLocations =
        priorLocations.length > 0 ? priorLocations : factLocations;
      await this.eventLocations.replaceForParsedEvent(persisted.id, []);
    }

    if (isPlaceCentricGeoEnabled()) {
      const providerKind = raw.sourceKind;
      const sourceProviderId = raw.providerKey;
      const sourceMessageId = raw.externalMessageId;
      const evidenceTargets = (activation.isActive ? factLocations : projectionLocations)
        .map((location) => location.placeId)
        .filter((placeId): placeId is string => typeof placeId === "string");
      const uniquePlaceIds = [...new Set(evidenceTargets)];
      const evidenceObservedAt = parsed.postedAt;
      const evidenceRows: EventEvidenceRecord[] = uniquePlaceIds.map((placeId) => ({
        id: randomUUID(),
        eventId: persisted.id,
        eventType: parsed.eventType,
        placeId,
        observedAt: evidenceObservedAt,
        timeBucket15m: evidenceObservedAt,
        providerKind,
        sourceProviderId,
        sourceChannelKey: raw.channelKey,
        sourceMessageId,
        traceId: raw.hash,
        payload: {
          rawMessageId,
          rawPayload: raw.rawPayload ?? null,
          rawText: raw.rawText,
          channelKey: raw.channelKey,
        },
        trustScore: undefined,
        createdAt: new Date().toISOString(),
      }));
      for (const evidence of evidenceRows) {
        await this.eventEvidence.append(evidence);
      }
    }

    const success = buildDomainEvent({
      type: "MessageParsed",
      aggregateType: "parsed_event",
      aggregateId: persisted.id,
      payload: {
        rawMessageId,
        channelKey: raw.channelKey,
        parserVersion: PARSER_VERSION,
        eventType: parsed.eventType,
        eventCategory,
        eventSubject,
        active: activation.isActive,
        inactiveReason: activation.inactiveReason,
        severity: parsed.severity,
        direction: parsed.direction,
        postedAt: parsed.postedAt,
        locations: projectionLocations.map((location) => ({
          regionId: location.regionId,
          regionCode: location.regionCode,
          placeId: location.placeId,
          precision: location.precision,
          entityKind: location.entityKind ?? (location.placeId ? "place" : "region"),
          confidence: location.confidence,
          authorChannelKey: raw.channelKey,
          action: isClearingEvent ? "clear" : "raise",
          statusCode: location.statusCode ?? parsed.eventType,
          occurredAt: parsed.postedAt,
        })),
      },
    });
    await this.events.publish([success]);
  }
}
