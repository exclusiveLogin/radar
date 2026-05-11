import type {
  EventLocation,
  IPlaceAliasRepository,
  IPlaceCacheRepository,
  PlaceContribution,
  IPlaceEvidenceRepository,
  IPlaceRepository,
  IRegionRepository,
  IEventLocationRepository,
  IParsedEventRepository,
  IRawMessageRepository,
  PlaceAliasRecord,
  PlaceEvidenceRecord,
  PlaceRecord,
  ParsedEvent,
  RegionRecord,
  RawMessage,
} from "@radar/shared";
import { randomUUID } from "node:crypto";
import { mergePlaceContribution } from "../parsing/placeContributionMerge.js";

export class InMemoryRawMessageRepository implements IRawMessageRepository {
  private readonly byHash = new Map<string, { id: string; raw: RawMessage }>();
async upsert(raw: RawMessage): Promise<{ inserted: boolean; id: string }> {
    const existing = this.byHash.get(raw.hash);
    if (existing) return { inserted: false, id: existing.id };
    const id = randomUUID();
    this.byHash.set(raw.hash, { id, raw });
    return { inserted: true, id };
  }
}

export class InMemoryParsedEventRepository implements IParsedEventRepository {
  private readonly rows = new Map<string, ParsedEvent>();
async upsert(parsed: ParsedEvent): Promise<{ id: string }> {
    const id = randomUUID();
    this.rows.set(id, parsed);
    return { id };
  }
}

export class InMemoryEventLocationRepository implements IEventLocationRepository {
  private readonly rows = new Map<string, EventLocation[]>();
async replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void> {
    this.rows.set(parsedEventId, locations);
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
async findByCode(code: string): Promise<RegionRecord | null> {
    return this.rows.get(code) ?? null;
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
    targetKind: "region" | "place";
    regionId?: string;
    placeId?: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void> {
    const aliasNormalized = input.alias.toLowerCase().trim();
    const key = `${input.targetKind}:${input.regionId ?? ""}:${input.placeId ?? ""}:${aliasNormalized}`;
    const existing = this.rows.get(key);
    if (existing) {
      existing.alias = input.alias;
      return;
    }
    this.rows.set(key, {
      id: randomUUID(),
      alias: input.alias,
      aliasNormalized,
      targetKind: input.targetKind,
      regionId: input.regionId,
      placeId: input.placeId,
      source: input.source,
    });
  }
async upsertMany(aliases: PlaceAliasRecord[]): Promise<void> {
    for (const row of aliases) {
      const key = `${row.targetKind}:${row.regionId ?? ""}:${row.placeId ?? ""}:${row.aliasNormalized}`;
      this.rows.set(key, row);
    }
  }
}

export class InMemoryPlaceCacheRepository implements IPlaceCacheRepository {
  private readonly rows = new Map<
    string,
    {
      provider: "dadata" | "nominatim" | "llm";
      raw: Record<string, unknown>;
      fetchedAt?: string;
      validatedAt?: string;
      confidence?: number;
    }
  >();
async get(
    queryNorm: string,
    provider?: "dadata" | "nominatim" | "llm",
  ): Promise<
    | {
        provider: "dadata" | "nominatim" | "llm";
        raw: Record<string, unknown>;
        fetchedAt?: string;
        validatedAt?: string;
        confidence?: number;
      }
    | null
  > {
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
    provider: "dadata" | "nominatim" | "llm",
    value: Record<string, unknown>,
    meta?: {
      confidence?: number;
      validator?: "rule" | "human" | "provider";
      expiresAt?: string;
      validatedAt?: string;
    },
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

export class InMemoryPlaceEvidenceRepository implements IPlaceEvidenceRepository {
  private readonly rows = new Map<string, PlaceEvidenceRecord[]>();

  async append(record: PlaceEvidenceRecord): Promise<void> {
    const current = this.rows.get(record.placeId) ?? [];
    current.push(record);
    this.rows.set(record.placeId, current);
  }

  async listByPlace(placeId: string, limit: number): Promise<PlaceEvidenceRecord[]> {
    const rows = this.rows.get(placeId) ?? [];
    return rows.slice(-limit).reverse();
  }
}
