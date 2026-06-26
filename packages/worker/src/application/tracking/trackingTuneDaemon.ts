/**
 * Подхватывает tracking_tune_runs со status=running и выполняет offline pattern search.
 */
import type { DataSource } from "typeorm";
import { executeTrackingTuneRun, pickRunningTuneRunId } from "./trackingTuneRunner.js";

const DEFAULT_POLL_MS = 5000;

function readPollMs(): number {
  const raw = Number(process.env.TRACKING_TUNE_DAEMON_POLL_MS);
  return Number.isFinite(raw) && raw >= 2000 ? raw : DEFAULT_POLL_MS;
}

function isEnabled(): boolean {
  const raw = process.env.TRACKING_TUNE_DAEMON_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return process.env.TRACKING_DAEMON_ENABLED !== "false";
}

export class TrackingTuneDaemon {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly ds: DataSource) {}

  start(): void {
    if (!isEnabled()) return;
    const pollMs = readPollMs();
    this.timer = setInterval(() => void this.tick(), pollMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const runId = await pickRunningTuneRunId(this.ds);
      if (!runId) return;
      await executeTrackingTuneRun(this.ds, runId);
    } catch (err) {
      console.error("[tracking-tune-daemon] tick failed:", err);
    } finally {
      this.ticking = false;
    }
  }
}

export function isTrackingTuneDaemonEnabled(): boolean {
  return isEnabled();
}
