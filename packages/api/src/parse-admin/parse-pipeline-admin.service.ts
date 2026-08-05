import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  parsePipelineStatusResponseSchema,
  type ParsePipelineJobKind,
  type ParsePipelinePhase,
  type ParsePipelineStartResponse,
  type ParsePipelineStatusResponse,
} from "@radar/shared";
import { spawn, type ChildProcess } from "child_process";
import { MONOREPO_ROOT } from "../monorepo-root";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";
import { ParseMaintenanceGate } from "./parse-maintenance.gate";

type JobState = {
  kind: ParsePipelineJobKind;
  status: "running" | "completed" | "failed";
  phase: ParsePipelinePhase;
  detail: string;
  logTail: string;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  child?: ChildProcess;
};

const IDLE: ParsePipelineStatusResponse = {
  status: "idle",
  kind: null,
  phase: null,
  detail: null,
  logTail: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  totalMessages: 0,
  processedMessages: 0,
  ok: 0,
  failed: 0,
  percentApprox: 0,
};

/**
 * Единый parse rebuild: maintenance → stop runs → CLI wipe → enqueue → прогресс очереди.
 */
@Injectable()
export class ParsePipelineAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(ParsePipelineAdminService.name);
  private job: JobState | null = null;

  constructor(
    private readonly phasesAdmin: PhasesAdminService,
    private readonly parseMaintenance: ParseMaintenanceGate,
  ) {}

  onModuleDestroy(): void {
    this.job?.child?.kill();
    if (this.parseMaintenance.isPaused()) {
      this.parseMaintenance.resume();
    }
  }

  async getStatus(): Promise<ParsePipelineStatusResponse> {
    if (this.job) {
      return parsePipelineStatusResponseSchema.parse(this.buildProcessStatus(this.job));
    }
    const catchUp = await this.phasesAdmin.getIngestCatchUpState();
    if (!catchUp) return IDLE;
    return parsePipelineStatusResponseSchema.parse(this.buildQueueStatus(catchUp));
  }

  /**
   * Штатный rebuild при живом API:
   * pause map-read → drain → stop runs → CLI wipe + catch-up enqueue → resume.
   */
  async startRebuild(): Promise<ParsePipelineStartResponse> {
    await this.assertNoRunningJob();
    this.parseMaintenance.pause();
    try {
      await this.parseMaintenance.waitForDrain();
      const stopped = await this.phasesAdmin.stopAllActiveRuns();
      this.logger.log(
        `rebuild preflight: runsClosed=${stopped.phaseRunsClosed}, queueCleared=${stopped.queueCleared}`,
      );
      // --no-force-locks: не рвём DB-сессии живого API (иначе Nest падает → ECONNREFUSED).
      // maintenance pause + stop runs уже сняли parse-конкуренцию; TRUNCATE soft-retry.
      return await this.startJob("rebuild", "parse-engine:pipeline:reset", [
        "--no-catch-up",
        "--no-force-locks",
      ]);
    } catch (error) {
      this.parseMaintenance.resume();
      throw error;
    }
  }

  private async startJob(
    kind: ParsePipelineJobKind,
    npmScript: string,
    extraArgs: string[],
  ): Promise<ParsePipelineStartResponse> {
    await this.assertNoRunningJob();
    const startedAt = new Date();
    const child = this.spawnWorkerScript(npmScript, extraArgs);

    this.job = {
      kind,
      status: "running",
      phase: "wiping",
      detail:
        "Очистка parse-слоя (TRUNCATE). Может занять 1–3 мин: снимаем worker-lock и чистим таблицы.",
      logTail: "",
      startedAt,
      child,
    };

    child.stdout?.on("data", (chunk: Buffer) => this.appendJobLog(kind, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.appendJobLog(kind, chunk));

    child.on("error", (err) => {
      this.logger.error(`${kind} spawn error: ${err.message}`);
      if (this.job?.kind === kind && this.job.status === "running") {
        this.job.status = "failed";
        this.job.finishedAt = new Date();
        this.job.error = err.message;
        this.job.detail = "CLI не запустился";
      }
      this.releaseMaintenance(kind);
    });

    child.on("close", (code) => {
      void this.onChildClosed(kind, code);
    });

    this.logger.log(`${kind} started (pid=${child.pid ?? "?"})`);
    return { ok: true, kind };
  }

  private appendJobLog(kind: ParsePipelineJobKind, chunk: Buffer): void {
    if (!this.job || this.job.kind !== kind || this.job.status !== "running") return;
    const text = chunk.toString();
    this.job.logTail = (this.job.logTail + text).slice(-4_000);
    const lastLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (lastLine && this.job.phase === "wiping") {
      this.job.detail = `Очистка: ${lastLine.slice(0, 180)}`;
    }
  }

  private async onChildClosed(
    kind: ParsePipelineJobKind,
    code: number | null,
  ): Promise<void> {
    if (!this.job || this.job.kind !== kind) return;
    const logTail = this.job.logTail;

    try {
      if (code === 0) {
        this.job.phase = "enqueueing";
        this.job.detail =
          "Wipe готов. Ставим необработанные raw в очередь (это может занять десятки секунд на больших архивах)…";
        this.job.child = undefined;
        this.releaseMaintenance(kind);

        try {
          const catchUp = await this.phasesAdmin.catchUpEnabledIngestPhases();
          this.logger.log(
            `${kind} queue: enqueued=${catchUp.enqueued}, queued=${catchUp.queued}`,
          );
          // Дальше статус читается из manual runs / queue counts.
          this.job = null;
        } catch (err) {
          this.logger.error(
            `${kind} catch-up failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.job = {
            kind,
            status: "failed",
            phase: "enqueueing",
            detail: "Не удалось поставить raw в очередь после wipe",
            logTail,
            startedAt: new Date(),
            finishedAt: new Date(),
            error:
              err instanceof Error ? err.message : `catch-up после wipe: ${String(err)}`,
          };
          return;
        }

        try {
          await this.phasesAdmin.pushMapSnapshot();
        } catch (err) {
          this.logger.warn(
            `pushMapSnapshot after ${kind}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return;
      }

      this.job.status = "failed";
      this.job.finishedAt = new Date();
      this.job.detail = "Очистка parse-слоя завершилась с ошибкой";
      this.job.error =
        logTail.trim().slice(-1_500) ||
        `CLI завершился с кодом ${code ?? "unknown"}`;
      this.logger.error(`${kind} failed: ${this.job.error}`);
    } finally {
      this.releaseMaintenance(kind);
    }
  }

  private releaseMaintenance(kind: ParsePipelineJobKind): void {
    if (kind !== "rebuild") return;
    if (!this.parseMaintenance.isPaused()) return;
    this.parseMaintenance.resume();
  }

  private spawnWorkerScript(
    npmScript: string,
    extraArgs: string[],
  ): ChildProcess {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["run", npmScript, "-w", "@radar/worker"];
    if (extraArgs.length > 0) args.push("--", ...extraArgs);

    return spawn(npmCmd, args, {
      cwd: MONOREPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  }

  private buildProcessStatus(job: JobState): ParsePipelineStatusResponse {
    return {
      status: job.status,
      kind: job.kind,
      phase: job.phase,
      detail: job.detail,
      logTail: job.logTail.trim() ? job.logTail.trim().slice(-1_200) : null,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error ?? null,
      totalMessages: 0,
      processedMessages: 0,
      ok: 0,
      failed: 0,
      percentApprox: job.status === "completed" ? 100 : 0,
    };
  }

  /** Прогресс очереди после wipe — тот же kind=rebuild. */
  private buildQueueStatus(
    state: NonNullable<
      Awaited<ReturnType<PhasesAdminService["getIngestCatchUpState"]>>
    >,
  ): ParsePipelineStatusResponse {
    const activeRuns = state.runs.filter((run) =>
      ["pending", "running", "paused"].includes(run.status),
    );
    const displayedRuns = activeRuns.length > 0 ? activeRuns : state.runs;
    const remaining = state.counts.pending + state.counts.processing;
    const totalMessages =
      remaining + state.counts.done + state.counts.failed;
    const processedMessages = state.counts.done + state.counts.failed;
    const failed = state.counts.failed;
    const completed = activeRuns.length === 0 && remaining === 0;
    const status =
      activeRuns.length > 0 ? "running" : completed ? "completed" : "failed";
    const startedAt =
      displayedRuns.map((run) => run.startedAt ?? run.createdAt).sort()[0] ?? null;
    const finishedAt =
      status === "running"
        ? null
        : displayedRuns
            .map((run) => run.finishedAt)
            .filter((value): value is string => value !== null)
            .sort()
            .at(-1) ?? null;
    const percentApprox =
      status === "completed"
        ? 100
        : totalMessages > 0
        ? Math.min(100, Math.round((processedMessages / totalMessages) * 1_000) / 10)
        : 0;

    const detail =
      status === "running"
        ? `Разбор очереди: ${processedMessages.toLocaleString()} / ${totalMessages.toLocaleString()} (осталось ${remaining.toLocaleString()})`
        : status === "completed"
          ? `Rebuild завершён: обработано ${processedMessages.toLocaleString()}`
          : `Очередь остановилась с ошибкой (fail ${failed.toLocaleString()})`;

    return {
      status,
      kind: "rebuild",
      phase: status === "running" ? "processing" : null,
      detail,
      logTail: null,
      startedAt,
      finishedAt,
      error:
        status === "failed"
          ? displayedRuns.find((run) => run.error)?.error ?? "rebuild queue failed"
          : null,
      totalMessages,
      processedMessages,
      ok: Math.max(0, processedMessages - failed),
      failed,
      percentApprox,
    };
  }

  private async assertNoRunningJob(): Promise<void> {
    if (this.job?.status === "running") {
      throw new BadRequestException(
        `Уже выполняется ${this.job.kind} (с ${this.job.startedAt.toISOString()})`,
      );
    }
    const catchUp = await this.phasesAdmin.getIngestCatchUpState();
    const activeRun = catchUp?.runs.find((run) =>
      ["pending", "running", "paused"].includes(run.status),
    );
    if (activeRun) {
      throw new BadRequestException(
        `Уже выполняется rebuild (с ${activeRun.startedAt ?? activeRun.createdAt})`,
      );
    }
  }
}
