import type { WorkerProbeStatus } from "@radar/shared";
import { workerProbeStatusSchema } from "@radar/shared";
import { ingestConnectionStatus } from "./ingest/ingestConnectionStatus.js";

type RuntimeState = {
  status: WorkerProbeStatus["status"];
  storageMode: string;
  workerRole: string;
  startedAt: string;
  heartbeatAt: string;
  orchestratorRunning: boolean;
  providerCount: number;
  bindingCount: number;
  liveInserted: number;
  backfillInserted: number;
  lastLiveAt: string | null;
  lastLiveChannelKey: string | null;
  lastError: string | null;
};

const state: RuntimeState = {
  status: "starting",
  storageMode: "unknown",
  workerRole: "uninitialized",
  startedAt: new Date().toISOString(),
  heartbeatAt: new Date().toISOString(),
  orchestratorRunning: false,
  providerCount: 0,
  bindingCount: 0,
  liveInserted: 0,
  backfillInserted: 0,
  lastLiveAt: null,
  lastLiveChannelKey: null,
  lastError: null,
};

/** SSOT runtime-снимка worker для probe /status. */
export const workerRuntimeStatus = {
  init(storageMode: string, workerRole: string): void {
    state.storageMode = storageMode;
    state.workerRole = workerRole;
    state.startedAt = new Date().toISOString();
    state.heartbeatAt = state.startedAt;
    state.status = "starting";
  },

  setRunning(): void {
    state.status = "running";
    state.heartbeatAt = new Date().toISOString();
  },

  setStopped(): void {
    state.status = "stopped";
    state.orchestratorRunning = false;
    state.heartbeatAt = new Date().toISOString();
  },

  touchHeartbeat(): void {
    state.heartbeatAt = new Date().toISOString();
  },

  setOrchestrator(input: {
    running: boolean;
    providerCount: number;
    bindingCount: number;
  }): void {
    state.orchestratorRunning = input.running;
    state.providerCount = input.providerCount;
    state.bindingCount = input.bindingCount;
    state.heartbeatAt = new Date().toISOString();
  },

  recordIngest(input: {
    ingestMode: string;
    inserted: boolean;
    channelKey: string;
  }): void {
    if (!input.inserted) return;
    if (input.ingestMode === "live") {
      state.liveInserted += 1;
      state.lastLiveAt = new Date().toISOString();
      state.lastLiveChannelKey = input.channelKey;
    } else if (input.ingestMode === "backfill") {
      state.backfillInserted += 1;
    }
    state.heartbeatAt = new Date().toISOString();
  },

  setError(message: string | null): void {
    state.lastError = message;
    state.heartbeatAt = new Date().toISOString();
  },

  clearError(): void {
    state.lastError = null;
    state.heartbeatAt = new Date().toISOString();
  },

  snapshot(): WorkerProbeStatus {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return workerProbeStatusSchema.parse({
      status: state.status,
      storageMode: state.storageMode,
      workerRole: state.workerRole,
      pid: process.pid,
      startedAt: state.startedAt,
      heartbeatAt: state.heartbeatAt,
      process: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        uptimeSec: process.uptime(),
        cpuUserSec: cpu.user / 1_000_000,
        cpuSystemSec: cpu.system / 1_000_000,
      },
      orchestrator: {
        running: state.orchestratorRunning,
        providerCount: state.providerCount,
        bindingCount: state.bindingCount,
      },
      ingest: {
        liveInserted: state.liveInserted,
        backfillInserted: state.backfillInserted,
        lastLiveAt: state.lastLiveAt,
        lastLiveChannelKey: state.lastLiveChannelKey,
        lastError: state.lastError,
        providers: ingestConnectionStatus.list(),
      },
    });
  },
};
