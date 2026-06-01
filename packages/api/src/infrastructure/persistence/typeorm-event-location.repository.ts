import type { EventLocation, IEventLocationRepository } from "@radar/shared";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { EventLocationEntity } from "../../events/entities";

export class TypeOrmEventLocationRepository implements IEventLocationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listForParsedEvent(parsedEventId: string): Promise<EventLocation[]> {
    const rows = await this.dataSource.getRepository(EventLocationEntity).find({
      where: { parsedEventId },
      relations: { region: true },
    });
    return rows.map((row) => ({
      regionId: row.regionId,
      regionCode: row.region?.iso ?? row.region?.name ?? "",
      placeId: row.placeId ?? undefined,
      precision: row.precision,
      source: row.source,
      lat: row.lat !== null ? Number(row.lat) : undefined,
      lon: row.lon !== null ? Number(row.lon) : undefined,
    }));
  }

  async replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void> {
    const repo = this.dataSource.getRepository(EventLocationEntity);
    await repo.delete({ parsedEventId });
    if (locations.length === 0) {
      return;
    }
    const rows = repo.create(
      locations.map((loc) => ({
        id: randomUUID(),
        parsedEventId,
        regionId: loc.regionId,
        placeId: loc.placeId ?? null,
        precision: loc.precision,
        lat: loc.lat !== undefined ? loc.lat.toFixed(6) : null,
        lon: loc.lon !== undefined ? loc.lon.toFixed(6) : null,
        source: loc.source,
      })),
    );
    await repo.save(rows, { chunk: 100 });
  }
}
