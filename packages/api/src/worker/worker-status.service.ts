import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  workerProbeStatusSchema,
  workerStatusResponseSchema,
  type WorkerStatusResponse,
} from "@radar/shared";
import type { DataSource } from "typeorm";

const PROBE_TIMEOUT_MS = 2_500;
const DEFAULT_PROBE_PORT = 3010;

@Injectable()
export class WorkerStatusService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Статус worker: HTTP probe + подсказки из БД (если probe недоступен). */
  async getStatus(): Promise<WorkerStatusResponse> {
    const probeUrl = this.resolveProbeUrl();
    const worker = await this.fetchProbe(probeUrl);
    const db = await this.loadDbHints();

    return workerStatusResponseSchema.parse({
      reachable: worker !== null,
      probeUrl,
      worker,
      db,
    });
  }

  private resolveProbeUrl(): string {
    const port = process.env.WORKER_PROBE_PORT?.trim() || String(DEFAULT_PROBE_PORT);
    return `http://127.0.0.1:${port}/status`;
  }

  private async fetchProbe(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const json: unknown = await response.json();
      return workerProbeStatusSchema.parse(json);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadDbHints(): Promise<WorkerStatusResponse["db"]> {
    const [providerRow] = await this.dataSource.query<
      Array<{ last_heartbeat_at: Date | null }>
    >(
      `SELECT MAX(last_heartbeat_at) AS last_heartbeat_at FROM ingest_providers`,
    );

    const [countsRow] = await this.dataSource.query<
      Array<{ live_count: string; backfill_count: string }>
    >(
      `SELECT
         COUNT(*) FILTER (WHERE ingest_mode = 'live') AS live_count,
         COUNT(*) FILTER (WHERE ingest_mode = 'backfill') AS backfill_count
       FROM raw_messages`,
    );

    const [lastRawRow] = await this.dataSource.query<
      Array<{ posted_at: Date | null; channel_key: string | null }>
    >(
      `SELECT rm.posted_at, ch.key AS channel_key
       FROM raw_messages rm
       LEFT JOIN channels ch ON ch.id = rm.channel_id
       ORDER BY rm.posted_at DESC NULLS LAST
       LIMIT 1`,
    );

    return {
      lastProviderHeartbeatAt: providerRow?.last_heartbeat_at?.toISOString() ?? null,
      liveMessageCount: Number(countsRow?.live_count ?? 0),
      backfillMessageCount: Number(countsRow?.backfill_count ?? 0),
      lastRawPostedAt: lastRawRow?.posted_at?.toISOString() ?? null,
      lastRawChannelKey: lastRawRow?.channel_key ?? null,
    };
  }
}
