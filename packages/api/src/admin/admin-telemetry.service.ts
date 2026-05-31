import { Injectable } from "@nestjs/common";
import { adminTelemetrySchema, type AdminTelemetry } from "@radar/shared";
import { WorkerStatusService } from "../worker/worker-status.service";

const API_STARTED_AT = new Date().toISOString();

/** Снимок метрик текущего процесса API (heap/cpu/uptime). */
function apiProcessSnapshot() {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    pid: process.pid,
    startedAt: API_STARTED_AT,
    process: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
      uptimeSec: process.uptime(),
      cpuUserSec: cpu.user / 1_000_000,
      cpuSystemSec: cpu.system / 1_000_000,
    },
  };
}

/** Сводная телеметрия процессов: API-процесс + worker (probe + БД-подсказки). */
@Injectable()
export class AdminTelemetryService {
  constructor(private readonly workerStatus: WorkerStatusService) {}

  async getTelemetry(): Promise<AdminTelemetry> {
    const worker = await this.workerStatus.getStatus();
    return adminTelemetrySchema.parse({
      capturedAt: new Date().toISOString(),
      api: apiProcessSnapshot(),
      worker,
    });
  }
}
