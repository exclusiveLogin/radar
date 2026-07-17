import type {
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  PhaseRun,
} from "@radar/shared";
import { PhaseRunner } from "./phaseRunner.js";

/**
 * Подхватывает log_parse_phase_run (trigger=manual, status=pending) из админки Run
 * и исполняет drain до опустошения claimable-очереди (батчами policy.batchSize).
 */
export class PhaseManualRunPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Фазы, у которых уже идёт тик (не дублируем параллельно). */
  private busyPhases = new Set<string>();
  /** Run id в работе (защита от повторного входа до await). */
  private executingRuns = new Set<string>();

  constructor(
    private readonly phases: IPhaseDefinitionRepository,
    private readonly phaseRuns: IPhaseRunRepository,
    private readonly runner: PhaseRunner,
    private readonly pollMs: number,
  ) {}

  start(): void {
    this.stopped = false;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.busyPhases.clear();
    this.executingRuns.clear();
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;

    const pending = (
      await this.phaseRuns.list({ trigger: "manual", status: "pending", limit: 30 })
    ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const run of pending) {
      if (this.stopped) return;
      if (this.executingRuns.has(run.id) || this.busyPhases.has(run.phaseId)) continue;
      await this.executeRun(run);
    }
  }

  private async executeRun(run: PhaseRun): Promise<void> {
    this.executingRuns.add(run.id);
    this.busyPhases.add(run.phaseId);
    try {
      const otherActive = await this.phaseRuns.findActiveForPhase(run.phaseId);
      if (otherActive && otherActive.id !== run.id) {
        return;
      }

      const phase = await this.phases.findById(run.phaseId);
      if (!phase) {
        await this.phaseRuns.updateStatus(run.id, "failed", {
          error: `phase ${run.phaseId} not found`,
        });
        return;
      }
      if (!phase.enabled) {
        await this.phaseRuns.updateStatus(run.id, "failed", {
          error: `phase ${run.phaseId} disabled`,
        });
        return;
      }

      await this.runner.runDrain({
        phase,
        runId: run.id,
        batchSize: phase.policy.batchSize,
        trigger: "manual",
      });
    } catch (err) {
      console.error(`PhaseManualRunPoller[${run.id}]:`, err);
    } finally {
      this.executingRuns.delete(run.id);
      this.busyPhases.delete(run.phaseId);
    }
  }
}
