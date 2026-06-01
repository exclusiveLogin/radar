import { spawn } from "node:child_process";
import { CronExpressionParser } from "cron-parser";
import type {
  IJobDefinitionRepository,
  IJobRunRepository,
  JobDefinition,
  JobRun,
} from "@radar/shared";
import { resolveJobCommand } from "./jobCommandRegistry.js";

type SpawnResult = { ok: boolean; code: number | null; tail: string };

/**
 * Демон планировщика (ADR-003, Фаза G): материализует job_runs из cron-расписаний
 * включённых определений и исполняет pending-запуски через npm-CLI (один запуск
 * за тик — последовательно). Прогресс/итог пишется в `job_runs`.
 *
 * Паттерн повторяет BackfillDaemonService (poll + tick + анти-реентерабельность).
 */
export class JobDaemonService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly definitions: IJobDefinitionRepository,
    private readonly runs: IJobRunRepository,
    private readonly repoRoot: string,
    private readonly pollMs = Number(process.env.RADAR_JOB_DAEMON_POLL_MS ?? "15000"),
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    console.log(`JobDaemon: poll каждые ${this.pollMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.materializeDueRuns();
      const run = await this.runs.findRunnable();
      if (run) await this.executeRun(run);
    } catch (err) {
      console.error("JobDaemon tick error:", err);
    } finally {
      this.ticking = false;
    }
  }

  /** Создаёт pending-запуски для определений, у которых наступило cron-время. */
  private async materializeDueRuns(): Promise<void> {
    const defs = await this.definitions.listEnabled();
    for (const def of defs) {
      if (!def.cron) continue;
      if (await this.isDue(def)) {
        await this.runs.create({ definitionId: def.id, type: def.type, params: def.params });
      }
    }
  }

  /** Наступило ли следующее cron-время после последнего запуска (или создания). */
  private async isDue(def: JobDefinition): Promise<boolean> {
    const latest = await this.runs.latestForDefinition(def.id);
    // Не плодим параллельные запуски одного определения.
    if (latest && (latest.status === "pending" || latest.status === "running")) {
      return false;
    }
    const base = new Date(latest?.createdAt ?? def.createdAt);
    try {
      const next = CronExpressionParser.parse(def.cron!, { currentDate: base })
        .next()
        .toDate();
      return next.getTime() <= Date.now();
    } catch (err) {
      console.error(`JobDaemon: некорректный cron у ${def.id}: ${def.cron}`, err);
      return false;
    }
  }

  private async executeRun(run: JobRun): Promise<void> {
    const command = resolveJobCommand(run.type, run.params);
    if (!command) {
      await this.runs.updateStatus(run.id, "failed", {
        error: `Нет команды для типа ${run.type}`,
      });
      return;
    }

    await this.runs.updateStatus(run.id, "running");
    console.log(`JobDaemon: run ${run.id} (${run.type}) → npm run ${command.script}`);

    const result = await this.spawnNpm(command.script, command.args);
    if (result.ok) {
      await this.runs.updateStatus(run.id, "completed", {
        stats: { exitCode: 0, tail: result.tail },
      });
    } else {
      await this.runs.updateStatus(run.id, "failed", {
        stats: { exitCode: result.code },
        error: result.tail.slice(-500) || `exit code ${result.code}`,
      });
    }
  }

  /** Запускает npm-скрипт из корня монорепы; собирает «хвост» вывода. */
  private spawnNpm(script: string, args: string[]): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const child = spawn("npm", ["run", script, "--", ...args], {
        cwd: this.repoRoot,
        shell: true,
        env: process.env,
      });

      let tail = "";
      const append = (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-4000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);

      child.on("error", (err) => resolve({ ok: false, code: null, tail: String(err) }));
      child.on("close", (code) => resolve({ ok: code === 0, code, tail }));
    });
  }
}

/** Включён ли демон планировщика (по умолчанию в db mode — да). */
export function isJobDaemonEnabled(): boolean {
  const flag = process.env.RADAR_JOB_DAEMON_ENABLED?.trim();
  return flag !== "0" && flag !== "false";
}
