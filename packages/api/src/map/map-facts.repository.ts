import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import {
  loadMapFacts,
  loadPlaceMapFacts,
  loadRegionMapFacts,
  loadVicinityMapFacts,
  type EventLocationFact,
} from "@radar/shared";

const REGION_FACTS_CACHE_MS = 1_000;

/** Порт загрузки фактов mat_parse_location для read-line fold. */
@Injectable()
export class MapFactsRepository {
  private regionFactsCache:
    | { expiresAt: number; value: Promise<EventLocationFact[]> }
    | undefined;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async loadFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadMapFacts(this.dataSource, asOf, ttlMs);
  }

  async loadRegionFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    const now = Date.now();
    if (this.regionFactsCache && this.regionFactsCache.expiresAt > now) {
      return this.regionFactsCache.value;
    }

    const value = loadRegionMapFacts(this.dataSource, asOf, ttlMs);
    this.regionFactsCache = { expiresAt: now + REGION_FACTS_CACHE_MS, value };
    void value.catch(() => {
      if (this.regionFactsCache?.value === value) this.regionFactsCache = undefined;
    });
    return value;
  }

  async loadPlaceFacts(
    asOf: Date,
    ttlMs: number,
    regionClears?: EventLocationFact[],
  ): Promise<EventLocationFact[]> {
    return loadPlaceMapFacts(this.dataSource, asOf, ttlMs, regionClears);
  }

  async loadVicinityFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadVicinityMapFacts(this.dataSource, asOf, ttlMs);
  }
}
