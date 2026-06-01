import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import { In, MoreThan } from "typeorm";
import {
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
} from "../events/entities";
import { RegionEntity } from "../geo/entities";
import { resolveRegionCentroid } from "./map-centroid.resolver";

type Emit = (message: WsServerMessage) => void;

const WARNING_TITLES: Record<string, string> = {
  grey: "Нет данных",
  green: "Отбой",
  yellow: "Внимание",
  orange: "Повышенная опасность",
  red: "Опасность",
};

/**
 * Realtime-источник для WS: опрашивает region_state_history по курсору changedAt
 * и эмитит смены состояния (region-state) и предупреждения (warnings).
 * Курсор стартует с момента запуска — начальное состояние клиент получает snapshot'ом.
 */
@Injectable()
export class RegionStatePoller {
  private timer: NodeJS.Timeout | null = null;
  private cursor = new Date();
  private readonly pollMs = 1000;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.cursor = new Date();
    this.timer = setInterval(() => void this.tick(emit), this.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(emit: Emit): Promise<void> {
    const rows = await this.dataSource
      .getRepository(RegionStateHistoryEntity)
      .find({
        where: { changedAt: MoreThan(this.cursor) },
        order: { changedAt: "ASC" },
        take: 200,
      });
    if (rows.length === 0) return;

    const activity = await this.loadActivity();
    const statusEventAt = await this.loadStatusEventAt(rows.map((row) => row.regionId));
    const regionById = await this.loadRegions(rows.map((row) => row.regionId));

    for (const row of rows) {
      const region = regionById.get(row.regionId);
      const centroid = region
        ? resolveRegionCentroid({ region })
        : undefined;
      const eventAtIso = statusEventAt.get(row.regionId)?.toISOString();

      emit({
        type: "region-state",
        payload: {
          regionId: row.regionId,
          regionCode: row.regionCode,
          stateLevel: row.stateLevel,
          previousLevel: row.previousLevel,
          activity: activity.get(row.regionId) ?? 0,
          reason: row.reason ?? undefined,
          changedAt: row.changedAt.toISOString(),
          statusEventAt: eventAtIso,
          centroidLat: centroid?.lat,
          centroidLon: centroid?.lon,
        },
      });
      emit({
        type: "warning",
        payload: {
          id: row.id,
          regionId: row.regionId,
          regionCode: row.regionCode,
          regionName: region?.name,
          title: WARNING_TITLES[row.stateLevel] ?? row.stateLevel,
          text: row.reason ?? undefined,
          stateLevel: row.stateLevel,
          eventAt: row.changedAt.toISOString(),
        },
      });
    }
    this.cursor = rows[rows.length - 1].changedAt;
  }

  private async loadRegions(ids: string[]): Promise<Map<string, RegionEntity>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(RegionEntity).find({
      where: { id: In(unique) },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async loadActivity(): Promise<Map<string, number>> {
    const rows = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();
    return new Map(rows.map((row) => [row.regionId, row.activity]));
  }

  private async loadStatusEventAt(ids: string[]): Promise<Map<string, Date>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.dataSource.getRepository(RegionStateActiveEntity).find({
      where: { regionId: In(unique) },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.statusEventAt) map.set(row.regionId, row.statusEventAt);
    }
    return map;
  }
}
