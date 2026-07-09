import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { WsServerMessage } from "@radar/shared";
import type { DataSource } from "typeorm";

type Emit = (message: WsServerMessage) => void;

/**
 * WS realtime: эмит tracks-updated при изменении state_track_pipeline.updated_at.
 */
@Injectable()
export class TracksRealtimePoller {
  private timer: NodeJS.Timeout | null = null;
  private lastUpdatedAt: string | null = null;

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  start(emit: Emit): void {
    if (this.timer) return;
    this.lastUpdatedAt = null;
    this.timer = setInterval(() => void this.tick(emit), 2000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(emit: Emit): Promise<void> {
    try {
      const [row] = await this.ds.query<{ updated_at: Date | string }[]>(
        `SELECT updated_at FROM state_track_pipeline WHERE id = 'default'`,
      );
      if (!row?.updated_at) return;
      const at =
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at);
      if (this.lastUpdatedAt === at) return;
      this.lastUpdatedAt = at;
      emit({ type: "tracks-updated", payload: { at } });
    } catch (error) {
      console.warn("[TracksRealtimePoller] tick failed:", error);
    }
  }
}
