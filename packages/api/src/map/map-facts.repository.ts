import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { loadMapFacts, type EventLocationFact } from "@radar/shared";

/** Порт загрузки фактов event_locations для read-line fold. */
@Injectable()
export class MapFactsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async loadFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadMapFacts(this.dataSource, asOf, ttlMs);
  }
}
