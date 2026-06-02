import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { PlaceStateEvent, StateLevel, WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import {
  StatusDictionaryEntity,
} from "../events/entities";
import { PlaceEntity } from "../geo/entities";
import {
  advanceHistoryPollCursor,
  createHistoryPollCursor,
  historyAfterCursorWhere,
  type HistoryPollCursor,
} from "./history-poller-cursor";

type Emit = (message: WsServerMessage) => void;

/**
 * Realtime по местам: опрашивает place_status_read_model и эмитит place-state.
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
   * (до/после operational reset в БД). Не меняет БД.
   */
  async broadcastActivePlaceDeactivations(emit: Emit): Promise<number> {
    if (this.levelByStatus.size === 0) {
      await this.loadDictionary();
    }

    const rows = (await this.dataSource.query(
      `
      SELECT psm.place_id,
             psm.status_code,
             p.name AS place_name,
             p.region_id,
             r.iso AS region_code,
             p.centroid_lat,
             p.centroid_lon
      FROM place_status_read_model psm
      JOIN places p ON p.id = psm.place_id
      JOIN regions r ON r.id = p.region_id
      WHERE psm.action = 'raise'
      `,
    )) as Array<{
      place_id: string;
      status_code: string;
      place_name: string;
      region_id: string;
      region_code: string | null;
      centroid_lat: string | null;
      centroid_lon: string | null;
    }>;

    let sent = 0;
    for (const row of rows) {
      const stateLevel = this.levelByStatus.get(row.status_code) ?? "grey";
      const lat = row.centroid_lat ? Number(row.centroid_lat) : undefined;
      const lon = row.centroid_lon ? Number(row.centroid_lon) : undefined;
      const payload: PlaceStateEvent = {
        placeId: row.place_id,
        placeName: row.place_name,
        regionId: row.region_id,
        regionCode: row.region_code ?? "",
        statusCode: row.status_code,
        stateLevel,
        action: "deactivate",
        lat,
        lon,
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

    const afterCursor = historyAfterCursorWhere("psm.updated_at", "psm.place_id", this.cursor);
    const rows = (await this.dataSource
      .createQueryBuilder()
      .select("psm.place_id", "place_id")
      .addSelect("psm.region_id", "region_id")
      .addSelect("psm.status_code", "status_code")
      .addSelect("psm.state_level", "state_level")
      .addSelect("psm.action", "action")
      .addSelect("psm.updated_at", "updated_at")
      .addSelect("psm.winner_occurred_at", "winner_occurred_at")
      .addSelect("p.name", "place_name")
      .addSelect("r.iso", "region_code")
      .addSelect("p.centroid_lat", "centroid_lat")
      .addSelect("p.centroid_lon", "centroid_lon")
      .from("place_status_read_model", "psm")
      .innerJoin(PlaceEntity, "p", "p.id = psm.place_id")
      .innerJoin("regions", "r", "r.id = p.region_id")
      .where(afterCursor.clause, afterCursor.params)
      .orderBy("psm.updated_at", "ASC")
      .addOrderBy("psm.place_id", "ASC")
      .limit(200)
      .getRawMany()) as Array<{
      place_id: string;
      place_name: string;
      region_id: string;
      region_code: string | null;
      status_code: string;
      state_level: StateLevel;
      action: "raise" | "clear";
      updated_at: Date;
      winner_occurred_at: Date;
      centroid_lat: string | null;
      centroid_lon: string | null;
    }>;
    if (rows.length === 0) return;

    for (const row of rows) {
      const stateLevel = this.levelByStatus.get(row.status_code) ?? row.state_level ?? "grey";
      const lat = row.centroid_lat ? Number(row.centroid_lat) : undefined;
      const lon = row.centroid_lon ? Number(row.centroid_lon) : undefined;

      const payload: PlaceStateEvent = {
        placeId: row.place_id,
        placeName: row.place_name,
        regionId: row.region_id,
        regionCode: row.region_code ?? "",
        statusCode: row.status_code,
        stateLevel,
        action: row.action === "raise" ? "activate" : "deactivate",
        lat,
        lon,
        changedAt: new Date(row.winner_occurred_at).toISOString(),
      };

      if (payload.action === "activate" && stateLevel === "grey") continue;
      if (payload.action === "activate" && (payload.lat === undefined || payload.lon === undefined)) {
        continue;
      }

      emit({ type: "place-state", payload });
    }

    const last = rows[rows.length - 1]!;
    this.cursor = advanceHistoryPollCursor(this.cursor, {
      at: new Date(last.updated_at),
      id: last.place_id,
    });
  }
}
