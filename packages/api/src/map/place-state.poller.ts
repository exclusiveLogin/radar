import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { PlaceStateEvent, StateLevel, WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import { MoreThan } from "typeorm";
import {
  PlaceStatusHistoryEntity,
  StatusDictionaryEntity,
} from "../events/entities";
import { resolvePlaceMapCentroid } from "./map-centroid.resolver";

type Emit = (message: WsServerMessage) => void;

/**
 * Realtime по местам: опрашивает place_status_history и эмитит place-state.
 * Координаты: place → region (только WGS84 из БД).
 */
@Injectable()
export class PlaceStatePoller {
  private timer: NodeJS.Timeout | null = null;
  private cursor = new Date();
  private readonly pollMs = 1000;
  private levelByStatus = new Map<string, StateLevel>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.cursor = new Date();
    void this.loadDictionary();
    this.timer = setInterval(() => void this.tick(emit), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async loadDictionary(): Promise<void> {
    const rows = await this.dataSource
      .getRepository(StatusDictionaryEntity)
      .find({ where: { isActive: true } });
    this.levelByStatus = new Map(
      rows.map((row) => [row.code, row.stateLevel as StateLevel]),
    );
  }

  private async tick(emit: Emit): Promise<void> {
    if (this.levelByStatus.size === 0) {
      await this.loadDictionary();
    }

    const rows = await this.dataSource
      .getRepository(PlaceStatusHistoryEntity)
      .find({
        where: { eventAt: MoreThan(this.cursor) },
        order: { eventAt: "ASC" },
        take: 200,
        relations: { place: { region: true } },
      });
    if (rows.length === 0) return;

    for (const row of rows) {
      const stateLevel = this.levelByStatus.get(row.statusCode) ?? "grey";
      const place = row.place;
      const region = place?.region;
      if (!place || !region) continue;

      const regionCode = region.iso ?? region.name;
      const coords = resolvePlaceMapCentroid({ place, region });

      const payload: PlaceStateEvent = {
        placeId: row.placeId,
        placeName: place.name,
        regionId: region.id,
        regionCode,
        statusCode: row.statusCode,
        stateLevel,
        action: row.action,
        lat: coords?.lat,
        lon: coords?.lon,
        changedAt: row.eventAt.toISOString(),
      };

      if (row.action === "activate" && stateLevel === "grey") continue;
      if (row.action === "activate" && (payload.lat === undefined || payload.lon === undefined)) {
        continue;
      }

      emit({ type: "place-state", payload });
    }

    this.cursor = rows[rows.length - 1].eventAt;
  }
}
