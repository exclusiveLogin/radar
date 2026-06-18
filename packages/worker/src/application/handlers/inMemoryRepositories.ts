import { parseKladrSubjectPrefix } from "@radar/shared";
import type {
  EventLocation,
  EventEvidenceRecord,
  IEventEvidenceRepository,
  IPlaceAliasRepository,
  PlaceCacheHit,
  PlaceCacheProvider,
  PlaceCachePutMeta,
  IPlaceCacheRepository,
  IPlaceEnrichmentJobRepository,
  PlaceEnrichmentJobRecord,
  PlaceEnrichmentProvider,
  PlaceContribution,
  IPlaceRepository,
  IRegionRepository,
  IEventLocationRepository,
  IParsedEventRepository,
  IMessageParseWorkspaceRepository,
  MessageParseWorkspaceRecord,
  IRawMessageRepository,
  PlaceAliasRecord,
  PlaceRecord,
  ParsedEvent,
  RegionRecord,
  RawMessage,
  RawMessageTelegramExtension,
  TimelineQuery,
} from "@radar/shared";
import { mergePlaceContribution } from "@radar/shared";
import { randomUUID } from "node:crypto";

export class InMemoryRawMessageRepository implements IRawMessageRepository {
  private readonly byHash = new Map<string, { id: string; raw: RawMessage }>();

  async upsert(
    raw: RawMessage,
    _extension?: RawMessageTelegramExtension,
  ): Promise<{ inserted: boolean; id: string }> {
    const existing = this.byHash.get(raw.hash);
    if (existing) return { inserted: false, id: existing.id };
    const id = randomUUID();
    this.byHash.set(raw.hash, { id, raw: { ...raw, id } });
    return { inserted: true, id };
  }

  async findById(id: string): Promise<RawMessage | null> {
    for (const row of this.byHash.values()) {
      if (row.id === id) return row.raw;
    }
    return null;
  }

  async findByHash(hash: string): Promise<{ id: string; raw: RawMessage } | null> {
    return this.byHash.get(hash) ?? null;
  }

  async listTimeline(query: TimelineQuery) {
    const items = [...this.byHash.values()]
      .map((r) => r.raw)
      .filter((r) => r.channelKey === query.channelKey)
      .sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    const ordered = query.order === "desc" ? items.reverse() : items;
    return { items: ordered.slice(0, query.limit), nextAnchor: null };
  }
}

export class InMemoryParsedEventRepository implements IParsedEventRepository {
  private readonly byId = new Map<string, ParsedEvent & { id: string }>();

  async upsert(parsed: ParsedEvent): Promise<{ id: string }> {
    const existing = [...this.byId.values()].find(
      (row) =>
        row.rawMessageId === parsed.rawMessageId
        && row.parserVersion === parsed.parserVersion,
    );
    return this.upsertById(existing?.id, parsed);
  }

  async findByRawMessageId(rawMessageId: string): Promise<(ParsedEvent & { id: string }) | null> {
    const all = await this.findAllByRawMessageId(rawMessageId);
    return all[0] ?? null;
  }

  async findAllByRawMessageId(rawMessageId: string): Promise<(ParsedEvent & { id: string })[]> {
    return [...this.byId.values()]
      .filter((row) => row.rawMessageId === rawMessageId)
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  }

  async upsertById(id: string | undefined, parsed: ParsedEvent): Promise<{ id: string }> {
    if (id && this.byId.has(id)) {
      this.byId.set(id, { ...parsed, id });
      return { id };
    }
    const newId = id ?? randomUUID();
    this.byId.set(newId, { ...parsed, id: newId });
    return { id: newId };
  }

  async deactivateById(id: string, inactiveReason?: string): Promise<void> {
    const row = this.byId.get(id);
    if (!row) return;
    this.byId.set(id, {
      ...row,
      isActive: false,
      inactiveReason: inactiveReason ?? "workspace:orphan_sweep",
    });
  }

  async hardDeleteById(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

export class InMemoryMessageParseWorkspaceRepository implements IMessageParseWorkspaceRepository {
  private readonly rows = new Map<string, MessageParseWorkspaceRecord>();

  async findActiveByRawMessageId(
    rawMessageId: string,
  ): Promise<MessageParseWorkspaceRecord | null> {
    const rows = [...this.rows.values()]
      .filter((row) => row.rawMessageId === rawMessageId && row.status === "finalized")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows[0] ?? null;
  }

  async supersedeActiveForRaw(rawMessageId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.rawMessageId === rawMessageId && row.status === "finalized") {
        this.rows.set(id, { ...row, status: "superseded" });
      }
    }
  }

  async saveFinalized(input: {
    rawMessageId: string;
    parserRevision: string;
    groomedText: string;
    workspace: MessageParseWorkspaceRecord["workspace"];
    spawnedEventIds: string[];
    candidateEventMap: Record<string, string>;
  }): Promise<MessageParseWorkspaceRecord> {
    await this.supersedeActiveForRaw(input.rawMessageId);
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: MessageParseWorkspaceRecord = {
      id,
      rawMessageId: input.rawMessageId,
      parserRevision: input.parserRevision,
      status: "finalized",
      groomedText: input.groomedText,
      workspace: input.workspace,
      spawnedEventIds: input.spawnedEventIds,
      candidateEventMap: input.candidateEventMap,
      finalizedAt: now,
      createdAt: now,
    };
    this.rows.set(id, record);
    return record;
  }
}

export class InMemoryEventLocationRepository implements IEventLocationRepository {
  private readonly rows = new Map<string, EventLocation[]>();

  async listForParsedEvent(parsedEventId: string): Promise<EventLocation[]> {
    return [...(this.rows.get(parsedEventId) ?? [])];
  }

  async replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void> {
    this.rows.set(parsedEventId, locations);
  }
}

export class InMemoryEventEvidenceRepository implements IEventEvidenceRepository {
  private readonly rows: EventEvidenceRecord[] = [];

  async append(record: EventEvidenceRecord): Promise<void> {
    this.rows.push(record);
  }
}

export class InMemoryPlaceEnrichmentJobRepository
implements IPlaceEnrichmentJobRepository {
  private readonly rows = new Map<string, PlaceEnrichmentJobRecord>();

  async enqueue(placeId: string, provider: PlaceEnrichmentProvider): Promise<void> {
    const key = `${placeId}:${provider}`;
    const existing = this.rows.get(key);
    if (existing?.status === "done") return;
    const now = new Date().toISOString();
    this.rows.set(key, {
      id: existing?.id ?? randomUUID(),
      placeId,
      provider,
      status: "pending",
      attempts: existing?.attempts ?? 0,
      lastError: existing?.lastError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async enqueueCatchUp(_provider: PlaceEnrichmentProvider): Promise<{ enqueued: number }> {
    return { enqueued: 0 };
  }

  async claimBatch(
    provider: PlaceEnrichmentProvider,
    limit: number,
  ): Promise<PlaceEnrichmentJobRecord[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.provider === provider && row.status === "pending")
      .slice(0, limit)
      .map((row) => ({
        ...row,
        status: "processing" as const,
        updatedAt: new Date().toISOString(),
      }));
    for (const row of rows) {
      this.rows.set(`${row.placeId}:${row.provider}`, row);
    }
    return rows;
  }

  async markDone(id: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.id !== id) continue;
      this.rows.set(key, {
        ...row,
        status: "done",
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  async markFailed(id: string, error: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.id !== id) continue;
      this.rows.set(key, {
        ...row,
        status: "failed",
        attempts: row.attempts + 1,
        lastError: error,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  async releaseToPending(ids: string[]): Promise<number> {
    const idSet = new Set(ids);
    let released = 0;
    for (const [key, row] of this.rows) {
      if (!idSet.has(row.id) || row.status !== "processing") continue;
      this.rows.set(key, {
        ...row,
        status: "pending",
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      });
      released += 1;
    }
    return released;
  }

  async resetProcessingForProvider(provider: PlaceEnrichmentProvider): Promise<number> {
    let reset = 0;
    for (const [key, row] of this.rows) {
      if (row.provider !== provider || row.status !== "processing") continue;
      this.rows.set(key, {
        ...row,
        status: "pending",
        lastError: undefined,
        updatedAt: new Date().toISOString(),
      });
      reset += 1;
    }
    return reset;
  }

  async countByStatus(
    provider: PlaceEnrichmentProvider,
  ): Promise<Record<PlaceEnrichmentJobRecord["status"], number>> {
    const base: Record<PlaceEnrichmentJobRecord["status"], number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of this.rows.values()) {
      if (row.provider === provider) {
        base[row.status] += 1;
      }
    }
    return base;
  }

  async clearQueuedWork(provider?: PlaceEnrichmentProvider): Promise<number> {
    let cleared = 0;
    for (const [key, row] of this.rows) {
      if (provider && row.provider !== provider) continue;
      if (row.status === "pending" || row.status === "processing") {
        this.rows.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }
}

export class InMemoryRegionRepository implements IRegionRepository {
  private readonly rows = new Map<string, RegionRecord>();

  constructor() {
    const seed: RegionRecord[] = [
      {
        id: "31f31f31-f31f-431f-931f-31f31f31f31f",
        code: "31",
        name: "Белгородская область",
        frontRegion: true,
        borderRegion: true,
      },
      {
        id: "36f36f36-f36f-436f-936f-36f36f36f36f",
        code: "36",
        name: "Воронежская область",
        frontRegion: false,
        borderRegion: false,
      },
      {
        id: "46f46f46-f46f-446f-946f-46f46f46f46f",
        code: "46",
        name: "Курская область",
        frontRegion: true,
        borderRegion: true,
      },
      {
        id: "61f61f61-f61f-461f-961f-61f61f61f61f",
        code: "61",
        name: "Ростовская область",
        frontRegion: true,
        borderRegion: true,
      },
    ];
    for (const row of seed) {
      this.rows.set(row.code, row);
    }
  }
  async findById(id: string): Promise<RegionRecord | null> {
    for (const row of this.rows.values()) {
      if (row.id === id) return row;
    }
    return null;
  }
  async findByCode(code: string): Promise<RegionRecord | null> {
    const normalized = code.trim().toUpperCase() === "UA-43"
      ? "RU-CR"
      : code;
    const direct = this.rows.get(normalized);
    if (direct) return direct;

    const prefix = parseKladrSubjectPrefix(normalized);
    if (!prefix) return null;

    return this.rows.get(prefix) ?? null;
  }
  async listActive(): Promise<RegionRecord[]> {
    return [...this.rows.values()];
  }
  async upsertMany(regions: RegionRecord[]): Promise<void> {
    for (const row of regions) {
      this.rows.set(row.code, row);
    }
  }
}

export class InMemoryPlaceRepository implements IPlaceRepository {
  private readonly rows = new Map<string, PlaceRecord>();

  async findById(id: string): Promise<PlaceRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async findByFias(fiasId: string): Promise<PlaceRecord | null> {
    for (const row of this.rows.values()) {
      if (row.fiasId === fiasId) {
        return row;
      }
    }
    return null;
  }
  async findRegionPlaceByRegionId(regionId: string): Promise<PlaceRecord | null> {
    for (const row of this.rows.values()) {
      if (row.regionId === regionId && row.kind === "region") {
        return row;
      }
    }
    return null;
  }
  async findByNameInRegion(
    name: string,
    regionId: string,
  ): Promise<PlaceRecord | null> {
    const normalized = name.toLowerCase().trim();
    for (const row of this.rows.values()) {
      if (
        row.regionId === regionId &&
        row.name.toLowerCase().trim() === normalized
      ) {
        return row;
      }
    }
    return null;
  }
  async findByStemInRegion(
    stem: string,
    regionId: string,
    preferKind?: PlaceRecord["kind"],
  ): Promise<PlaceRecord | null> {
    const matches: PlaceRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.regionId === regionId && (row.nameStem ?? row.name.toLowerCase()) === stem) {
        matches.push(row);
      }
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    if (preferKind) {
      const preferred = matches.find((r) => r.kind === preferKind);
      if (preferred) return preferred;
    }
    return matches[0];
  }
  async listActive(): Promise<PlaceRecord[]> {
    return [...this.rows.values()];
  }
  async upsertMany(places: PlaceRecord[]): Promise<void> {
    for (const row of places) {
      this.rows.set(row.id, row);
    }
  }
  async mergeContribution(
    input: PlaceContribution,
  ): Promise<{ updated: PlaceRecord; appliedFields: string[] }> {
    const existing = this.rows.get(input.placeId);
    if (!existing) {
      throw new Error(`Place not found for contribution merge: ${input.placeId}`);
    }
    const merged = mergePlaceContribution(existing, input);
    this.rows.set(input.placeId, merged.next);
    return { updated: merged.next, appliedFields: merged.appliedFields };
  }
}

export class InMemoryPlaceAliasRepository implements IPlaceAliasRepository {
  private readonly rows = new Map<string, PlaceAliasRecord>();

  async findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]> {
    const result: PlaceAliasRecord[] = [];
    for (const row of this.rows.values()) {
      if (row.aliasNormalized === aliasNormalized) {
        result.push(row);
      }
    }
    return result;
  }
  async listActive(): Promise<PlaceAliasRecord[]> {
    return [...this.rows.values()];
  }
  async upsertAlias(input: {
    placeId: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void> {
    const aliasNormalized = input.alias.toLowerCase().trim();
    const key = `${input.placeId}:${aliasNormalized}`;
    const existing = this.rows.get(key);
    if (existing) {
      existing.alias = input.alias;
      return;
    }
    this.rows.set(key, {
      id: randomUUID(),
      placeId: input.placeId,
      alias: input.alias,
      aliasNormalized,
      source: input.source,
    });
  }
  async upsertMany(aliases: PlaceAliasRecord[]): Promise<void> {
    for (const row of aliases) {
      const key = `${row.placeId}:${row.aliasNormalized}`;
      this.rows.set(key, row);
    }
  }
}

export class InMemoryPlaceCacheRepository implements IPlaceCacheRepository {
  private readonly rows = new Map<string, PlaceCacheHit>();

  async get(
    queryNorm: string,
    provider?: PlaceCacheProvider,
  ): Promise<PlaceCacheHit | null> {
    if (provider) {
      return this.rows.get(`${provider}:${queryNorm}`) ?? null;
    }
    for (const [key, value] of this.rows.entries()) {
      if (key.endsWith(`:${queryNorm}`)) {
        return value;
      }
    }
    return null;
  }
  async put(
    queryNorm: string,
    provider: PlaceCacheProvider,
    value: Record<string, unknown>,
    meta?: PlaceCachePutMeta,
  ): Promise<void> {
    this.rows.set(`${provider}:${queryNorm}`, {
      provider,
      raw: value,
      fetchedAt: new Date().toISOString(),
      validatedAt: meta?.validatedAt,
      confidence: meta?.confidence,
    });
  }
}

