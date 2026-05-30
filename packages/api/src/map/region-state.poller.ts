import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";
import { MoreThan } from "typeorm";
import {
  RegionStateActiveEntity,
  RegionStateHistoryEntity,
} from "../events/entities";

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
    for (const row of rows) {
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
        },
      });
      emit({
        type: "warning",
        payload: {
          id: row.id,
          regionId: row.regionId,
          regionCode: row.regionCode,
          title: WARNING_TITLES[row.stateLevel] ?? row.stateLevel,
          text: row.reason ?? undefined,
          stateLevel: row.stateLevel,
          eventAt: row.changedAt.toISOString(),
        },
      });
    }
    this.cursor = rows[rows.length - 1].changedAt;
  }

  private async loadActivity(): Promise<Map<string, number>> {
    const rows = await this.dataSource
      .getRepository(RegionStateActiveEntity)
      .find();
    return new Map(rows.map((row) => [row.regionId, row.activity]));
  }
}
