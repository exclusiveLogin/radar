import type {
  DomainEvent,
  EventHandler,
  GeoEventCategory,
  ProvenanceAccumulator,
  IStatusDictionaryRepository,
  StatusDictionaryRecord,
} from "@radar/shared";
import { SOURCE_TRUST, mergeContribution } from "@radar/shared";
import type { DataSource } from "typeorm";
import { bridgeEventCategoryToCode } from "../../domain/region-state/eventCategoryBridge.js";

type ParsedLocation = {
  regionId: string;
  regionCode: string;
  placeId?: string;
  entityKind?: "region" | "place" | "point";
  confidence?: number;
  action?: "raise" | "clear";
  statusCode?: string;
  authorChannelKey?: string;
  occurredAt?: string;
};

type MessageParsedPayload = {
  rawMessageId?: string;
  eventType: string;
  eventCategory?: GeoEventCategory;
  eventSubject?: string;
  active?: boolean;
  postedAt?: string;
  channelKey?: string;
  locations?: ParsedLocation[];
};

type ProjectionDeps = {
  dataSource: DataSource;
  statusDictionary: IStatusDictionaryRepository;
};

/**
 * Read-model проекция LastWinner для region/place.
 * Источник: MessageParsed + event_locations факты.
 */
export class LastWinnerReadModelProjection {
  private dictionary: StatusDictionaryRecord[] | null = null;
  private stateLevelByCode: Map<string, string> | null = null;

  constructor(private readonly deps: ProjectionDeps) {}

  readonly handler: EventHandler = async (event: DomainEvent): Promise<void> => {
    if (event.type !== "MessageParsed") return;
    const payload = event.payload as MessageParsedPayload;
    const locations = payload.locations ?? [];

    // Отбой без геолокаций: чистим все регионы, в которые канал писал за последние 24ч.
    if (payload.eventType === "cleared" && locations.length === 0 && payload.channelKey) {
      await this.ensureDictionary();
      const resolvedStatusCode = this.resolveDeactivateStatusCode();
      const fallbackOccurredAt = payload.postedAt ?? event.occurredAt;
      await this.clearChannelRegions(payload.channelKey, resolvedStatusCode, fallbackOccurredAt);
      return;
    }

    if (locations.length === 0) return;

    await this.ensureDictionary();
    const resolvedStatusCode =
      payload.active === false
        ? this.resolveDeactivateStatusCode()
        : this.resolveEffectiveStatusCode(payload.eventType, payload.eventCategory);
    const resolvedStateLevel = this.levelOf(resolvedStatusCode);
    const fallbackAction: "raise" | "clear" =
      payload.active === false || resolvedStateLevel === "green" ? "clear" : "raise";
    const fallbackOccurredAt = payload.postedAt ?? event.occurredAt;

    const clearTargetRegionIds = await this.resolveClearTargets({
      payload,
      locations,
    });

    for (const location of locations) {
      const statusCode = location.statusCode ?? resolvedStatusCode;
      const stateLevel = this.levelOf(statusCode);
      const action = location.action ?? (stateLevel === "green" ? "clear" : fallbackAction);
      const authorChannelKey = location.authorChannelKey ?? payload.channelKey ?? null;
      const occurredAt = location.occurredAt ?? fallbackOccurredAt;
      const entityKind = location.entityKind ?? (location.placeId ? "place" : "region");

      await this.upsertRegionWinner({
        regionId: location.regionId,
        regionCode: location.regionCode,
        statusCode,
        stateLevel,
        action,
        authorChannelKey,
        occurredAt,
      });

      if (location.placeId && entityKind !== "region") {
        await this.upsertPlaceWinner({
          placeId: location.placeId,
          regionId: location.regionId,
          statusCode,
          stateLevel,
          action,
          authorChannelKey,
          occurredAt,
        });
      }

      if (entityKind === "region" && action === "clear" && authorChannelKey) {
        await this.clearAuthorPlacesInRegion({
          parsedEventId: String(event.aggregateId),
          regionId: location.regionId,
          statusCode,
          stateLevel,
          authorChannelKey,
          occurredAt,
        });
      }
    }

    if (clearTargetRegionIds.length > 0) {
      for (const target of clearTargetRegionIds) {
        await this.upsertRegionWinner({
          regionId: target.regionId,
          regionCode: target.regionCode,
          statusCode: resolvedStatusCode,
          stateLevel: this.levelOf(resolvedStatusCode),
          action: "clear",
          authorChannelKey: payload.channelKey ?? null,
          occurredAt: fallbackOccurredAt,
        });
        if (payload.channelKey) {
          await this.clearAuthorPlacesInRegion({
            parsedEventId: String(event.aggregateId),
            regionId: target.regionId,
            statusCode: resolvedStatusCode,
            stateLevel: this.levelOf(resolvedStatusCode),
            authorChannelKey: payload.channelKey,
            occurredAt: fallbackOccurredAt,
          });
        }
      }
    }
  };

  /**
   * Снимает тревогу со всех регионов, куда канал писал raise за последние 24 часа.
   * Используется для «глобального» отбоя без указания конкретных регионов.
   */
  private async clearChannelRegions(
    channelKey: string,
    statusCode: string,
    occurredAt: string,
  ): Promise<void> {
    const targets = (await this.deps.dataSource.query(
      `
      SELECT DISTINCT el.region_id, r.iso AS region_code
      FROM event_locations el
      JOIN regions r ON r.id = el.region_id
      JOIN parsed_events pe ON pe.id = el.parsed_event_id
      JOIN raw_messages rm ON rm.id = pe.raw_message_id
      JOIN channels c ON c.id = rm.channel_id AND c.key = $1
      WHERE el.action = 'raise'
        AND el.occurred_at > NOW() - INTERVAL '24 hours'
      `,
      [channelKey],
    )) as Array<{ region_id: string; region_code: string | null }>;

    for (const target of targets) {
      await this.upsertRegionWinner({
        regionId: target.region_id,
        regionCode: target.region_code ?? target.region_id,
        statusCode,
        stateLevel: this.levelOf(statusCode),
        action: "clear",
        authorChannelKey: channelKey,
        occurredAt,
      });
      await this.clearAuthorPlacesInRegion({
        parsedEventId: null,
        regionId: target.region_id,
        statusCode,
        stateLevel: this.levelOf(statusCode),
        authorChannelKey: channelKey,
        occurredAt,
      });
    }
  }

  private async resolveClearTargets(input: {
    payload: MessageParsedPayload;
    locations: ParsedLocation[];
  }): Promise<Array<{ regionId: string; regionCode: string }>> {
    if (input.payload.eventType !== "cleared") return [];
    const hasManyRegions = input.locations.filter((loc) => loc.entityKind !== "place").length > 1;
    if (hasManyRegions) return [];
    if (!input.payload.rawMessageId) return [];

    const rows = (await this.deps.dataSource.query(
      `
      SELECT rm.raw_text
      FROM raw_messages rm
      WHERE rm.id = $1
      `,
      [input.payload.rawMessageId],
    )) as Array<{ raw_text: string }>;
    const rawText = rows[0]?.raw_text ?? "";
    if (!rawText) return [];

    // Групповой отбой: перечисление субъектов через запятую после двоеточия.
    if (!/отбой/i.test(rawText) || !/:/.test(rawText)) {
      return [];
    }

    const regions = (await this.deps.dataSource.query(
      `SELECT id, iso, name, name_with_type, short_name FROM regions WHERE is_active = true`,
    )) as Array<{
      id: string;
      iso: string | null;
      name: string;
      name_with_type: string | null;
      short_name: string | null;
    }>;
    const normalize = (value: string): string =>
      value
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[!?.:;()[\]{}«»"']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const haystack = normalize(rawText);
    const hits: Array<{ regionId: string; regionCode: string }> = [];
    for (const region of regions) {
      const variants = [region.name, region.name_with_type ?? "", region.short_name ?? ""]
        .map((x) => normalize(x))
        .filter(Boolean);
      if (variants.some((variant) => haystack.includes(variant))) {
        hits.push({
          regionId: region.id,
          regionCode: region.iso ?? region.name,
        });
      }
    }
    return hits;
  }

  private async ensureDictionary(): Promise<void> {
    if (this.dictionary) return;
    this.dictionary = await this.deps.statusDictionary.listActive();
    this.stateLevelByCode = new Map(
      this.dictionary.map((entry) => [entry.code, entry.stateLevel]),
    );
  }

  private resolveDeactivateStatusCode(): string {
    const dictionary = this.dictionary ?? [];
    return bridgeEventCategoryToCode("all_clear", dictionary) ?? "cleared";
  }

  private resolveEffectiveStatusCode(
    ruleEventType: string,
    eventCategory: GeoEventCategory | undefined,
  ): string {
    const dictionary = this.dictionary ?? [];
    let merged: ProvenanceAccumulator = {};
    if (this.levelOf(ruleEventType) !== "grey") {
      merged = mergeContribution(merged, {
        eventType: {
          value: ruleEventType,
          source: "rule",
          trust: SOURCE_TRUST.rule,
          precision: "attribute",
        },
      });
    }
    const llmCode = eventCategory
      ? bridgeEventCategoryToCode(eventCategory, dictionary)
      : null;
    if (llmCode) {
      merged = mergeContribution(merged, {
        eventType: {
          value: llmCode,
          source: "llm",
          trust: SOURCE_TRUST.llm,
          precision: "attribute",
        },
      });
    }
    return (merged as { eventType?: { value?: string } }).eventType?.value ?? ruleEventType;
  }

  private levelOf(statusCode: string): string {
    return this.stateLevelByCode?.get(statusCode) ?? "grey";
  }

  private async upsertRegionWinner(input: {
    regionId: string;
    regionCode: string;
    statusCode: string;
    stateLevel: string;
    action: "raise" | "clear";
    authorChannelKey: string | null;
    occurredAt: string;
  }): Promise<void> {
    await this.deps.dataSource.query(
      `
      INSERT INTO region_status_read_model(
        region_id, region_code, status_code, state_level, action,
        author_channel_key, winner_occurred_at, stale, stale_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,false,NULL,now())
      ON CONFLICT(region_id) DO UPDATE
      SET region_code = EXCLUDED.region_code,
          status_code = EXCLUDED.status_code,
          state_level = EXCLUDED.state_level,
          action = EXCLUDED.action,
          author_channel_key = EXCLUDED.author_channel_key,
          winner_occurred_at = EXCLUDED.winner_occurred_at,
          stale = false,
          stale_at = NULL,
          updated_at = now()
      WHERE region_status_read_model.winner_occurred_at <= EXCLUDED.winner_occurred_at
        AND (
          EXCLUDED.action = 'clear'
          OR ARRAY_POSITION(
               ARRAY['grey','green','yellow','orange','red']::text[],
               EXCLUDED.state_level::text
             ) >=
             ARRAY_POSITION(
               ARRAY['grey','green','yellow','orange','red']::text[],
               region_status_read_model.state_level::text
             )
        )
      `,
      [
        input.regionId,
        input.regionCode,
        input.statusCode,
        input.stateLevel,
        input.action,
        input.authorChannelKey,
        input.occurredAt,
      ],
    );
  }

  private async upsertPlaceWinner(input: {
    placeId: string;
    regionId: string;
    statusCode: string;
    stateLevel: string;
    action: "raise" | "clear";
    authorChannelKey: string | null;
    occurredAt: string;
  }): Promise<void> {
    await this.deps.dataSource.query(
      `
      INSERT INTO place_status_read_model(
        place_id, region_id, status_code, state_level, action,
        author_channel_key, winner_occurred_at, stale, stale_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,false,NULL,now())
      ON CONFLICT(place_id) DO UPDATE
      SET region_id = EXCLUDED.region_id,
          status_code = EXCLUDED.status_code,
          state_level = EXCLUDED.state_level,
          action = EXCLUDED.action,
          author_channel_key = EXCLUDED.author_channel_key,
          winner_occurred_at = EXCLUDED.winner_occurred_at,
          stale = false,
          stale_at = NULL,
          updated_at = now()
      WHERE place_status_read_model.winner_occurred_at <= EXCLUDED.winner_occurred_at
        AND (
          EXCLUDED.action = 'clear'
          OR ARRAY_POSITION(
               ARRAY['grey','green','yellow','orange','red']::text[],
               EXCLUDED.state_level::text
             ) >=
             ARRAY_POSITION(
               ARRAY['grey','green','yellow','orange','red']::text[],
               place_status_read_model.state_level::text
             )
        )
      `,
      [
        input.placeId,
        input.regionId,
        input.statusCode,
        input.stateLevel,
        input.action,
        input.authorChannelKey,
        input.occurredAt,
      ],
    );
  }

  private async clearAuthorPlacesInRegion(input: {
    /** UUID parsed_event для записи в event_locations. Если не передан — INSERT пропускается. */
    parsedEventId: string | null;
    regionId: string;
    statusCode: string;
    stateLevel: string;
    authorChannelKey: string;
    occurredAt: string;
  }): Promise<void> {
    const activePlaces = (await this.deps.dataSource.query(
      `
      SELECT place_id
      FROM place_status_read_model
      WHERE region_id = $1
        AND author_channel_key = $2
        AND action = 'raise'
      `,
      [input.regionId, input.authorChannelKey],
    )) as Array<{ place_id: string }>;

    for (const row of activePlaces) {
      if (input.parsedEventId) {
        await this.deps.dataSource.query(
          `
          INSERT INTO event_locations(
            parsed_event_id, region_id, place_id, precision, lat, lon, source,
            entity_kind, confidence, author_channel_key, action, status_code, occurred_at
          )
          SELECT
            $1, $2, $3, 'locality', NULL, NULL, 'db',
            'place', NULL, $4, 'clear', $5, $6::timestamptz
          WHERE NOT EXISTS (
            SELECT 1
            FROM event_locations
            WHERE parsed_event_id = $1 AND place_id = $3 AND action = 'clear'
          )
          `,
          [
            input.parsedEventId,
            input.regionId,
            row.place_id,
            input.authorChannelKey,
            input.statusCode,
            input.occurredAt,
          ],
        );
      }
      await this.upsertPlaceWinner({
        placeId: row.place_id,
        regionId: input.regionId,
        statusCode: input.statusCode,
        stateLevel: input.stateLevel,
        action: "clear",
        authorChannelKey: input.authorChannelKey,
        occurredAt: input.occurredAt,
      });
    }
  }
}
