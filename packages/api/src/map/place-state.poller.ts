import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { PlaceStateEvent, StateLevel, WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  PlaceStatusActiveEntity,
  PlaceStatusHistoryEntity,
  StatusDictionaryEntity,
} from "../events/entities";
import { resolvePlaceMapCentroid } from "./map-centroid.resolver";
import {
  advanceHistoryPollCursor,
  createHistoryPollCursor,
  historyAfterCursorWhere,
  type HistoryPollCursor,
} from "./history-poller-cursor";

type Emit = (message: WsServerMessage) => void;

/**
 * Realtime по местам: опрашивает place_status_history и эмитит place-state.
 * Координаты: только собственный центроид места (без coords — точка не эмитится).
 */
@Injectable()
export class PlaceStatePoller {
  private timer: NodeJS.Timeout | null = null;
  private cursor: HistoryPollCursor = createHistoryPollCursor();
  private readonly pollMs = 1000;
  private levelByStatus = new Map<string, StateLevel>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.cursor = createHistoryPollCursor();
    void this.loadDictionary();
    this.timer = setInterval(() => void this.tick(emit), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Принудительно снять все активные места с карты у подписчиков WS
   * (до/после operational reset в БД). Не меняет place_status_active.
   */
  async broadcastActivePlaceDeactivations(emit: Emit): Promise<number> {
    if (this.levelByStatus.size === 0) {
      await this.loadDictionary();
    }

    const rows = await this.dataSource.getRepository(PlaceStatusActiveEntity).find({
      relations: { place: { region: true } },
    });

    let sent = 0;
    for (const row of rows) {
      const place = row.place;
      const region = place?.region;
      if (!place || !region) continue;

      const coords = resolvePlaceMapCentroid({ place });
      const stateLevel = this.levelByStatus.get(row.statusCode) ?? "grey";
      const payload: PlaceStateEvent = {
        placeId: row.placeId,
        placeName: place.name,
        regionId: region.id,
        regionCode: region.iso ?? region.name,
        statusCode: row.statusCode,
        stateLevel,
        action: "deactivate",
        lat: coords?.lat,
        lon: coords?.lon,
        changedAt: new Date().toISOString(),
      };
      emit({ type: "place-state", payload });
      sent += 1;
    }
    return sent;
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

    const afterCursor = historyAfterCursorWhere("h.event_at", "h.id", this.cursor);
    const rows = await this.dataSource
      .getRepository(PlaceStatusHistoryEntity)
      .createQueryBuilder("h")
      .innerJoinAndSelect("h.place", "place")
      .innerJoinAndSelect("place.region", "region")
      .where(afterCursor.clause, afterCursor.params)
      .orderBy("h.eventAt", "ASC")
      .addOrderBy("h.id", "ASC")
      .take(200)
      .getMany();
    if (rows.length === 0) return;

    for (const row of rows) {
      const stateLevel = this.levelByStatus.get(row.statusCode) ?? "grey";
      const place = row.place;
      const region = place?.region;
      if (!place || !region) continue;

      const regionCode = region.iso ?? region.name;
      const coords = resolvePlaceMapCentroid({ place });

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

    const last = rows[rows.length - 1]!;
    this.cursor = advanceHistoryPollCursor(this.cursor, {
      at: last.eventAt,
      id: last.id,
    });
  }
}
