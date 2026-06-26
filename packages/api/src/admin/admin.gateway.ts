import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  type OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  adminWsClientMessageSchema,
  type AdminWsChannel,
  type AdminWsServerMessage,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { WebSocket } from "ws";
import type { RawData, Server } from "ws";
import { WorkerStatusService } from "../worker/worker-status.service";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";
import { ParsePipelineAdminService } from "../parse-admin/parse-pipeline-admin.service";
import { TrackingAdminService } from "../tracking-admin/tracking-admin.service";
import { listParseAttemptsSince } from "../read-side/parse-attempt-admin.query";
import {
  listActiveBackfillJobs,
  listBackfillJobsByIds,
  mapBackfillAdminRow,
} from "../read-side/backfill-admin.query";

const ALL_CHANNELS: AdminWsChannel[] = [
  "worker-status",
  "parse-log",
  "backfill-progress",
  "phases-update",
  "tracking-status",
  "parse-pipeline-status",
];

const WORKER_STATUS_POLL_MS = 5000;
const PARSE_LOG_POLL_MS = 2000;
const BACKFILL_POLL_MS = 2000;
const PHASES_POLL_MS = 3000;
const TRACKING_POLL_MS = 3000;
const PARSE_PIPELINE_POLL_MS = 2000;

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
  /** Активные backfill job на прошлом тике — для финального WS-push. */
  private prevActiveBackfillIds = new Set<string>();
  private readonly logger = new Logger(AdminGateway.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly workerStatus: WorkerStatusService,
    private readonly phasesAdmin: PhasesAdminService,
    private readonly parsePipelineAdmin: ParsePipelineAdminService,
    private readonly trackingAdmin: TrackingAdminService,
  ) {}

  onModuleInit(): void {
    this.parseLogCursor = new Date();
    this.timers.push(
      setInterval(() => void this.pollWorkerStatus(), WORKER_STATUS_POLL_MS),
      setInterval(() => void this.pollParseLog(), PARSE_LOG_POLL_MS),
      setInterval(() => void this.pollBackfill(), BACKFILL_POLL_MS),
      setInterval(() => void this.pollPhasesUpdate(), PHASES_POLL_MS),
      setInterval(() => void this.pollTrackingStatus(), TRACKING_POLL_MS),
      setInterval(() => void this.pollParsePipelineStatus(), PARSE_PIPELINE_POLL_MS),
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
    try {
      const items = await listParseAttemptsSince(this.dataSource, this.parseLogCursor, 200);
      if (items.length === 0) return;

      for (const payload of items) {
        this.broadcast({ type: "parse-log", payload });
      }
      this.parseLogCursor = new Date(items[items.length - 1]!.createdAt);
    } catch {
      // poisoned pool / lock — пропуск тика
    }
  }

  private async pollBackfill(): Promise<void> {
    try {
      const activeRows = await listActiveBackfillJobs(this.dataSource, 50);
      const currentActiveIds = new Set(activeRows.map((row) => row.id));
      const finishedIds = [...this.prevActiveBackfillIds].filter((id) => !currentActiveIds.has(id));
      const finishedRows =
        finishedIds.length > 0
          ? await listBackfillJobsByIds(this.dataSource, finishedIds)
          : [];

      this.prevActiveBackfillIds = currentActiveIds;

      for (const row of [...activeRows, ...finishedRows]) {
        try {
          const payload = mapBackfillAdminRow(row);
          this.broadcast({ type: "backfill-progress", payload });
        } catch (err) {
          this.logger.warn(
            `backfill-progress skip job ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `pollBackfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  private async pollTrackingStatus(): Promise<void> {
    try {
      const payload = await this.trackingAdmin.getStatus();
      this.broadcast({ type: "tracking-status", payload });
    } catch {
      // Пропускаем тик.
    }
  }

  private async pollParsePipelineStatus(): Promise<void> {
    try {
      const payload = await this.parsePipelineAdmin.getStatus();
      this.broadcast({ type: "parse-pipeline-status", payload });
    } catch {
      // Пропускаем тик.
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
