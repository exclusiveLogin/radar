import type { IPhaseDefinitionRepository, PhaseDefinitionRecord } from "@radar/shared";
import { PhaseRunner } from "./phaseRunner.js";
import { sortPhasesByOrder } from "./phaseOrder.js";

const DEFAULT_POLL_MS = 15_000;

function isPhaseDaemonEnabled(): boolean {
  const raw = process.env.RADAR_PHASE_DAEMON_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return process.env.RADAR_STORAGE_MODE?.trim().toLowerCase() === "db";
}

function resolvePollMs(): number {
  const parsed = Number(process.env.RADAR_PHASE_DAEMON_POLL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
}

/**
 * Планировщик scheduled-фаз: interval per phase из policy.intervalMs.
 */
export class PhaseDaemonService {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = new Set<string>();

  constructor(
    private readonly phases: IPhaseDefinitionRepository,
    private readonly runner: PhaseRunner,
  ) {}

  static enabled(): boolean {
    return isPhaseDaemonEnabled();
  }

  start(): void {
    void this.refreshSchedules();
    setInterval(() => void this.refreshSchedules(), resolvePollMs());
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.running.clear();
  }

  private async refreshSchedules(): Promise<void> {
    const scheduled = sortPhasesByOrder(await this.phases.listEnabled("scheduled"));
    const ids = new Set(scheduled.map((p) => p.id));

    for (const [id, timer] of this.timers) {
      if (!ids.has(id)) {
        clearInterval(timer);
        this.timers.delete(id);
      }
    }

    for (const phase of scheduled) {
      if (this.timers.has(phase.id)) continue;
      const intervalMs = Math.max(phase.policy.intervalMs, phase.policy.minIntervalMs, 1000);
      const timer = setInterval(() => void this.tickPhase(phase), intervalMs);
      this.timers.set(phase.id, timer);
    }
  }

  private async tickPhase(phase: PhaseDefinitionRecord): Promise<void> {
    if (this.running.has(phase.id)) return;
    this.running.add(phase.id);
    try {
      await this.runner.runPhaseTick({
        phase,
        trigger: "scheduled",
        batchSize: phase.policy.batchSize,
      });
    } catch (err) {
      console.error(`PhaseDaemon[${phase.id}]:`, err);
    } finally {
      this.running.delete(phase.id);
    }
  }
}
