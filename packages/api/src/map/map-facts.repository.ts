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

/** Порт загрузки фактов event_locations для read-line fold. */
@Injectable()
export class MapFactsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async loadFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadMapFacts(this.dataSource, asOf, ttlMs);
  }

  async loadRegionFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadRegionMapFacts(this.dataSource, asOf, ttlMs);
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
