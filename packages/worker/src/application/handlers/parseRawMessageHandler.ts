import type { ParseWorkspaceMessageService } from "../parse/ParseWorkspaceMessageService.js";
import type {
  EventEvidenceRecord,
  GeoEnrichmentArtifact,
  IEventEvidenceRepository,
  IEventLocationRepository,
  IEventPublisher,
  IParsedEventRepository,
  RawMessage,
} from "@radar/shared";
import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";
import type { ParsePhaseContext } from "../parse/parsePhaseContext.js";
import type { ParseEnricherId } from "../../domain/parse/parseEnricherRegistry.js";
import { loadGeoEnrichmentState } from "../geo-pipeline/geoEnrichmentState.js";
import { resolveParsedEventActivation } from "../../domain/parsing/resolveParsedEventActivation.js";
import { PARSER_VERSION } from "../../domain/parsing/version.js";
import { buildDomainEvent } from "./domainEventFactory.js";
import { randomUUID } from "node:crypto";
import { isPlaceCentricGeoEnabled } from "../../infrastructure/config/placeCentricFeatureFlag.js";

export type { ParsePhaseContext } from "../parse/parsePhaseContext.js";

/**
 * Use case: raw → Parse Workspace → finalize → mat_parse_event.
 * @see ../../../../../docs/rfc/parse-processor-workspace.md
 */
export class ParseRawMessageHandler {
  constructor(
    private readonly workspaceService: ParseWorkspaceMessageService,
    private readonly parsedEvents: IParsedEventRepository,
    private readonly eventLocations: IEventLocationRepository,
    private readonly eventEvidence: IEventEvidenceRepository,
    private readonly events: IEventPublisher,
    private readonly phaseContext: ParsePhaseContext = { phaseMode: "baseline" },
  ) {}

  private get phaseMode(): GeoPipelinePhaseMode {
    return this.phaseContext.phaseMode ?? "baseline";
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

    try {
      const result = await this.workspaceService.run({
        rawMessageId,
        rawText: raw.rawText,
        postedAt: raw.postedAt,
        runKind: this.phaseContext.runKind ?? "rebuild",
        geoContext: {
          initialArtifact: priorState?.artifact,
          enrichers: (this.phaseContext.enrichers ?? ["catalog"]) as ParseEnricherId[],
        },
        mode:
          this.phaseContext.runKind === "heal"
            ? "heal"
            : this.phaseContext.runKind === "phase_enrich"
              ? "refinalize"
              : priorState
                ? "refinalize"
                : "initial",
      });

      if (result.kind !== "event") {
        await this.events.publish([
          buildDomainEvent({
            type: "MessageParseFailed",
            aggregateType: "raw_message",
            aggregateId: rawMessageId,
            payload: {
              reason: result.reason,
              channelKey: raw.channelKey,
              rawMessageId,
              parserVersion: PARSER_VERSION,
              outcome: "skipped",
            },
          }),
        ]);
        return;
      }

      const artifact = result.workspace.namespaces.geoArtifact as
        | GeoEnrichmentArtifact
        | undefined;
      const activation = resolveParsedEventActivation(artifact);
      const persistedEvents = await this.parsedEvents.findAllByRawMessageId(rawMessageId);

      for (const candidate of result.workspace.candidates) {
        const eventId = result.finalize.candidateEventMap[candidate.id];
        if (!eventId) continue;
        const record = persistedEvents.find((row) => row.id === eventId);
        if (!record) continue;

        const locations = await this.eventLocations.listForParsedEvent(eventId);
        const isClearingEvent = !activation.isActive || record.eventType === "cleared";

        if (isPlaceCentricGeoEnabled()) {
          const uniquePlaceIds = [
            ...new Set(
              locations
                .map((location) => location.placeId)
                .filter((placeId): placeId is string => typeof placeId === "string"),
            ),
          ];
          const evidenceRows: EventEvidenceRecord[] = uniquePlaceIds.map((placeId) => ({
            id: randomUUID(),
            eventId,
            eventType: record.eventType,
            placeId,
            observedAt: record.postedAt,
            timeBucket15m: record.postedAt,
            providerKind: raw.sourceKind,
            sourceProviderId: raw.providerKey,
            sourceChannelKey: raw.channelKey,
            sourceMessageId: raw.externalMessageId,
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

        await this.events.publish([
          buildDomainEvent({
            type: "MessageParsed",
            aggregateType: "parsed_event",
            aggregateId: eventId,
            payload: {
              rawMessageId,
              channelKey: raw.channelKey,
              parserVersion: PARSER_VERSION,
              eventType: record.eventType,
              eventCategory: artifact?.llm?.eventCategory,
              eventSubject: artifact?.llm?.eventSubject ?? record.eventSubject,
              active: activation.isActive,
              inactiveReason: activation.inactiveReason,
              severity: record.severity,
              direction: record.direction,
              postedAt: record.postedAt,
              locations: (activation.isActive ? locations : []).map((location) => ({
                id: location.id,
                regionId: location.regionId,
                regionCode: location.regionCode,
                placeId: location.placeId,
                precision: location.precision,
                entityKind: location.entityKind ?? (location.placeId ? "place" : "region"),
                confidence: location.confidence,
                authorChannelKey: raw.channelKey,
                action: isClearingEvent ? "clear" : "raise",
                statusCode: location.statusCode ?? record.eventType,
                occurredAt: record.postedAt,
              })),
              eventLocationIds: (activation.isActive ? locations : [])
                .map((location) => location.id)
                .filter((id): id is string => typeof id === "string" && id.length > 0),
            },
          }),
        ]);
      }
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
  }
}
