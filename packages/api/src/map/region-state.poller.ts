import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { StateLevel, WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import { In } from "typeorm";
import { RegionEntity } from "../geo/entities";
import { resolveRegionCentroid } from "./map-centroid.resolver";
import {
  advanceHistoryPollCursor,
  createHistoryPollCursor,
  historyAfterCursorWhere,
  type HistoryPollCursor,
} from "./history-poller-cursor";

type Emit = (message: WsServerMessage) => void;

const WARNING_TITLES: Record<string, string> = {
  grey: "Нет данных",
  green: "Отбой",
  yellow: "Внимание",
  orange: "Повышенная опасность",
  red: "Опасность",
};

/**
 * Realtime-источник для WS: опрашивает region_status_read_model по updated_at
 * и эмитит смены состояния (region-state) и предупреждения (warnings).
 * Курсор стартует с момента запуска — начальное состояние клиент получает snapshot'ом.
 */
@Injectable()
export class RegionStatePoller {
  private timer: NodeJS.Timeout | null = null;
  private cursor: HistoryPollCursor = createHistoryPollCursor();
  private readonly pollMs = 1000;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.cursor = createHistoryPollCursor();
    this.timer = setInterval(() => void this.tick(emit), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(emit: Emit): Promise<void> {
    const afterCursor = historyAfterCursorWhere("rm.updated_at", "rm.region_id", this.cursor);
    const rows = (await this.dataSource
      .createQueryBuilder()
      .select("rm.region_id", "region_id")
      .addSelect("rm.region_code", "region_code")
      .addSelect("rm.state_level", "state_level")
      .addSelect("rm.status_code", "reason")
      .addSelect("rm.updated_at", "updated_at")
      .addSelect("rm.winner_occurred_at", "changed_at")
      .from("region_status_read_model", "rm")
      .where(afterCursor.clause, afterCursor.params)
      .orderBy("rm.updated_at", "ASC")
      .addOrderBy("rm.region_id", "ASC")
      .limit(200)
      .getRawMany()) as Array<{
      region_id: string;
      region_code: string;
      state_level: StateLevel;
      reason: string;
      updated_at: Date;
      changed_at: Date;
    }>;
    if (rows.length === 0) return;

    const regionById = await this.loadRegions(rows.map((row) => row.region_id));

    for (const row of rows) {
      const region = regionById.get(row.region_id);
      const centroid = region
        ? resolveRegionCentroid({ region })
        : undefined;
      const eventAtIso = new Date(row.changed_at).toISOString();

      emit({
        type: "region-state",
        payload: {
          regionId: row.region_id,
          regionCode: row.region_code,
          stateLevel: row.state_level as StateLevel,
          previousLevel: "grey",
          activity: 0,
          reason: row.reason ?? undefined,
          changedAt: new Date(row.changed_at).toISOString(),
          statusEventAt: eventAtIso,
          centroidLat: centroid?.lat,
          centroidLon: centroid?.lon,
        },
      });
      emit({
        type: "warning",
        payload: {
          id: `${row.region_id}:${new Date(row.updated_at).toISOString()}`,
          regionId: row.region_id,
          regionCode: row.region_code,
          regionName: region?.name,
          title: WARNING_TITLES[row.state_level] ?? row.state_level,
          text: row.reason ?? undefined,
          stateLevel: row.state_level as StateLevel,
          eventAt: new Date(row.changed_at).toISOString(),
        },
      });
    }
    const last = rows[rows.length - 1]!;
    this.cursor = advanceHistoryPollCursor(this.cursor, {
      at: new Date(last.updated_at),
      id: last.region_id,
    });
  }

  private async loadRegions(ids: string[]): Promise<Map<string, RegionEntity>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(RegionEntity).find({
      where: { id: In(unique) },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

}
