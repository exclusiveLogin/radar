import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  type OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  adminWsClientMessageSchema,
  backfillJobListItemSchema,
  parseAttemptItemSchema,
  type AdminWsChannel,
  type AdminWsServerMessage,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { WebSocket } from "ws";
import type { RawData, Server } from "ws";
import { WorkerStatusService } from "../worker/worker-status.service";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";

const ALL_CHANNELS: AdminWsChannel[] = [
  "worker-status",
  "parse-log",
  "backfill-progress",
  "phases-update",
];

const WORKER_STATUS_POLL_MS = 5000;
const PARSE_LOG_POLL_MS = 2000;
const BACKFILL_POLL_MS = 5000;
const PHASES_POLL_MS = 3000;

type ParseAttemptRow = {
  id: string;
  raw_message_id: string;
  channel_key: string | null;
  parser_version: string;
  status: "ok" | "failed" | "skipped";
  errors: Record<string, unknown> | null;
  created_at: Date;
};

type BackfillRow = {
  id: string;
  binding_id: string;
  provider_id: string;
  strategy: string;
  params: Record<string, unknown>;
  status: string;
  stats: { inserted: number; duplicates: number; parsed: number };
  created_at: Date;
  updated_at: Date;
  channel_key: string | null;
};

/** Канал, к которому относится серверное сообщение админ-WS. */
function channelOf(message: AdminWsServerMessage): AdminWsChannel {
  return message.type;
}

/**
 * WebSocket-шлюз админки (path `/ws/admin`): транслирует подписанным клиентам
 * телеметрию worker, новые строки parse_attempts и прогресс backfill-задач.
 * Источники — серверные поллеры (как RegionStatePoller), без доступа к воркеру напрямую.
 */
@WebSocketGateway({ path: "/ws/admin" })
export class AdminGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;

  private readonly subscriptions = new Map<WebSocket, Set<AdminWsChannel>>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private parseLogCursor = new Date();
  /** ID run-ов, которые были в статусе running на предыдущем тике — для детекции завершения. */
  private prevRunningIds = new Set<string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workerStatus: WorkerStatusService,
    private readonly phasesAdmin: PhasesAdminService,
  ) {}

  onModuleInit(): void {
    this.parseLogCursor = new Date();
    this.timers.push(
      setInterval(() => void this.pollWorkerStatus(), WORKER_STATUS_POLL_MS),
      setInterval(() => void this.pollParseLog(), PARSE_LOG_POLL_MS),
      setInterval(() => void this.pollBackfill(), BACKFILL_POLL_MS),
      setInterval(() => void this.pollPhasesUpdate(), PHASES_POLL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  handleConnection(client: WebSocket): void {
    this.subscriptions.set(client, new Set(ALL_CHANNELS));
    client.on("message", (raw) => this.onClientMessage(client, raw));
    client.on("close", () => this.subscriptions.delete(client));
    void this.pollWorkerStatus();
  }

  private onClientMessage(client: WebSocket, raw: RawData): void {
    const parsed = this.parseClientMessage(raw);
    if (!parsed) return;
    const channels = this.subscriptions.get(client) ?? new Set<AdminWsChannel>();
    for (const channel of parsed.channels) {
      if (parsed.type === "subscribe") channels.add(channel);
      else channels.delete(channel);
    }
    this.subscriptions.set(client, channels);
  }

  private parseClientMessage(raw: RawData) {
    try {
      const result = adminWsClientMessageSchema.safeParse(
        JSON.parse(raw.toString()),
      );
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private async pollWorkerStatus(): Promise<void> {
    try {
      const payload = await this.workerStatus.getStatus();
      this.broadcast({ type: "worker-status", payload });
    } catch {
      // probe недоступен — пропускаем тик, следующий повторит.
    }
  }

  private async pollParseLog(): Promise<void> {
    const rows = await this.dataSource.query<ParseAttemptRow[]>(
      `SELECT id, raw_message_id, channel_key, parser_version, status, errors, created_at
       FROM parse_attempts
       WHERE created_at > $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [this.parseLogCursor],
    );
    if (rows.length === 0) return;

    for (const row of rows) {
      this.broadcast({
        type: "parse-log",
        payload: parseAttemptItemSchema.parse({
          id: row.id,
          rawMessageId: row.raw_message_id,
          channelKey: row.channel_key,
          parserVersion: row.parser_version,
          status: row.status,
          errors: row.errors,
          createdAt: row.created_at.toISOString(),
        }),
      });
    }
    this.parseLogCursor = rows[rows.length - 1].created_at;
  }

  private async pollBackfill(): Promise<void> {
    const rows = await this.dataSource.query<BackfillRow[]>(
      `SELECT j.id, j.binding_id, j.provider_id, j.strategy, j.params, j.status,
              j.stats, j.created_at, j.updated_at, c.key AS channel_key
       FROM ingest_backfill_jobs j
       LEFT JOIN ingest_bindings b ON b.id = j.binding_id
       LEFT JOIN channels c ON c.id = b.channel_id
       WHERE j.status IN ('pending', 'running')
       ORDER BY j.updated_at DESC
       LIMIT 50`,
    );

    for (const row of rows) {
      const checkpoint = this.readCheckpoint(row.params);
      this.broadcast({
        type: "backfill-progress",
        payload: backfillJobListItemSchema.parse({
          id: row.id,
          bindingId: row.binding_id,
          providerId: row.provider_id,
          strategy: row.strategy,
          params: row.params,
          status: row.status,
          stats: row.stats,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          channelKey: row.channel_key,
          progress: {
            inserted: row.stats.inserted,
            duplicates: row.stats.duplicates,
            parsed: row.stats.parsed,
            checkpointOffsetId: checkpoint?.offsetId ?? null,
            checkpointPostedAt: checkpoint?.postedAt ?? null,
          },
        }),
      });
    }
  }

  private readCheckpoint(
    params: Record<string, unknown>,
  ): { offsetId: string; postedAt: string } | null {
    const raw = params.checkpoint;
    if (!raw || typeof raw !== "object") return null;
    const cp = raw as { offsetId?: unknown; postedAt?: unknown };
    if (typeof cp.offsetId !== "string" || typeof cp.postedAt !== "string") return null;
    return { offsetId: cp.offsetId, postedAt: cp.postedAt };
  }

  private async pollPhasesUpdate(): Promise<void> {
    try {
      const [overview, runs] = await Promise.all([
        this.phasesAdmin.runsOverview(),
        this.phasesAdmin.listRuns({ limit: 20 }),
      ]);

      // Детекция завершения фаз: если run был running и стал completed/failed → push snapshot.
      const currentRunningIds = new Set(
        runs.filter((r) => r.status === "running").map((r) => r.id),
      );
      const justFinished = [...this.prevRunningIds].some(
        (id) => !currentRunningIds.has(id),
      );
      if (justFinished) {
        void this.phasesAdmin.pushMapSnapshot();
      }
      this.prevRunningIds = currentRunningIds;

      this.broadcast({ type: "phases-update", payload: { overview, runs } });
    } catch {
      // Пропускаем тик — сервис недоступен.
    }
  }

  private broadcast(message: AdminWsServerMessage): void {
    const channel = channelOf(message);
    const data = JSON.stringify(message);
    for (const [client, channels] of this.subscriptions) {
      if (client.readyState === WebSocket.OPEN && channels.has(channel)) {
        client.send(data);
      }
    }
  }
}
