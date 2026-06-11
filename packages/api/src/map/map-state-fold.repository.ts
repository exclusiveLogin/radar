import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { loadMapFoldFacts, type EventLocationFact } from "@radar/shared";

/** Загрузка фактов event_locations для fold на маркере asOf. */
@Injectable()
export class MapStateFoldRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async loadFacts(asOf: Date, ttlMs: number): Promise<EventLocationFact[]> {
    return loadMapFoldFacts(this.dataSource, asOf, ttlMs);
  }
}
