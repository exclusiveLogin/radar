import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  parsePipelineStatusResponseSchema,
  type ParsePipelineJobKind,
  type ParsePipelineStartResponse,
  type ParsePipelineStatusResponse,
} from "@radar/shared";
import { spawn, type ChildProcess } from "child_process";
import { MONOREPO_ROOT } from "../monorepo-root";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";

type JobState = {
  kind: ParsePipelineJobKind;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  totalMessages: number;
  phaseIds: string[];
  failedAtStart: number;
  child?: ChildProcess;
};

const IDLE: ParsePipelineStatusResponse = {
  status: "idle",
  kind: null,
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
 * Reset запускается через worker CLI; catch-up только планирует очередь и будит worker-ы.
 */
@Injectable()
export class ParsePipelineAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(ParsePipelineAdminService.name);
  private job: JobState | null = null;

  constructor(private readonly phasesAdmin: PhasesAdminService) {}

  onModuleDestroy(): void {
    this.job?.child?.kill();
  }

  async getStatus(): Promise<ParsePipelineStatusResponse> {
    if (!this.job) return IDLE;
    return parsePipelineStatusResponseSchema.parse(await this.buildStatus(this.job));
  }

  async startReset(): Promise<ParsePipelineStartResponse> {
    return this.startJob("reset", "parse-engine:pipeline:reset", ["--no-force-locks"]);
  }

  /** Планирует отсутствующие raw и разбирает очередь батчами без очистки таблиц. */
  async startCatchUp(): Promise<ParsePipelineStartResponse> {
    this.assertNoRunningJob();

    const startedAt = new Date();
    this.job = {
      kind: "catchup",
      status: "running",
      startedAt,
      totalMessages: 0,
      phaseIds: [],
      failedAtStart: 0,
    };
    void this.initializeCatchUp(startedAt);
    this.logger.log("catchup planning started");
    return { ok: true, kind: "catchup" };
  }

  /** Планирует очередь асинхронно, чтобы Admin сразу получил running-статус. */
  private async initializeCatchUp(startedAt: Date): Promise<void> {
    try {
      const catchUp = await this.phasesAdmin.catchUpEnabledIngestPhases();
      if (!this.job || this.job.kind !== "catchup" || this.job.startedAt !== startedAt) return;

      const completed = catchUp.queued === 0;
      this.job.totalMessages = catchUp.queued;
      this.job.phaseIds = catchUp.phaseIds;
      this.job.failedAtStart = catchUp.failed;
      this.job.status = completed ? "completed" : "running";
      this.job.finishedAt = completed ? new Date() : undefined;
      this.logger.log(
        `catchup ${completed ? "completed" : "started"}: enqueued=${catchUp.enqueued}, queued=${catchUp.queued}`,
      );
    } catch (error) {
      if (!this.job || this.job.kind !== "catchup" || this.job.startedAt !== startedAt) return;
      this.job.status = "failed";
      this.job.finishedAt = new Date();
      this.job.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`catchup planning failed: ${this.job.error}`);
    }
  }

  private async startJob(
    kind: ParsePipelineJobKind,
    npmScript: string,
    extraArgs: string[],
  ): Promise<ParsePipelineStartResponse> {
    this.assertNoRunningJob();
    const startedAt = new Date();
    const child = this.spawnWorkerScript(npmScript, extraArgs);

    this.job = {
      kind,
      status: "running",
      startedAt,
      totalMessages: 0,
      phaseIds: [],
      failedAtStart: 0,
      child,
    };

    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    child.on("error", (err) => {
      this.logger.error(`${kind} spawn error: ${err.message}`);
      if (this.job?.kind === kind && this.job.status === "running") {
        this.job.status = "failed";
        this.job.finishedAt = new Date();
        this.job.error = err.message;
      }
    });

    child.on("close", (code) => {
      void this.onChildClosed(kind, code, stderrTail);
    });

    this.logger.log(`${kind} started (pid=${child.pid ?? "?"})`);
    return { ok: true, kind };
  }

  private async onChildClosed(
    kind: ParsePipelineJobKind,
    code: number | null,
    stderrTail: string,
  ): Promise<void> {
    if (!this.job || this.job.kind !== kind) return;

    if (code === 0) {
      this.job.status = "completed";
      this.job.finishedAt = new Date();
      this.logger.log(`${kind} completed`);
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
    this.job.error =
      stderrTail.trim().slice(-500) ||
      `CLI завершился с кодом ${code ?? "unknown"}`;
    this.logger.error(`${kind} failed: ${this.job.error}`);
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
      stdio: ["ignore", "ignore", "pipe"],
      shell: process.platform === "win32",
    });
  }

  private async buildStatus(job: JobState): Promise<ParsePipelineStatusResponse> {
    const base: ParsePipelineStatusResponse = {
      status: job.status,
      kind: job.kind,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error ?? null,
      totalMessages: job.totalMessages,
      processedMessages: 0,
      ok: 0,
      failed: 0,
      percentApprox: 0,
    };

    if (job.kind !== "catchup") {
      if (job.status === "running") base.percentApprox = 0;
      else base.percentApprox = job.status === "completed" ? 100 : 0;
      return base;
    }
    if (job.status === "running" && job.phaseIds.length === 0) {
      return base;
    }

    const counts = await this.phasesAdmin.getIngestQueueCounts(job.phaseIds);
    const remaining = counts.pending + counts.processing;
    const processedMessages = Math.max(0, job.totalMessages - Math.min(job.totalMessages, remaining));
    const failed = Math.max(0, counts.failed - job.failedAtStart);
    const ok = Math.max(0, processedMessages - failed);
    if (job.status === "running" && remaining === 0) {
      job.status = "completed";
      job.finishedAt = new Date();
      base.status = job.status;
      base.finishedAt = job.finishedAt.toISOString();
      this.logger.log("catchup completed");
    }

    const total = job.totalMessages;
    const percentApprox =
      job.status === "completed"
        ? 100
        : total > 0
        ? Math.min(100, Math.round((processedMessages / total) * 1_000) / 10)
        : 0;

    return {
      ...base,
      totalMessages: total,
      processedMessages,
      ok,
      failed,
      percentApprox,
    };
  }

  private assertNoRunningJob(): void {
    if (this.job?.status === "running") {
      throw new BadRequestException(
        `Уже выполняется ${this.job.kind} (с ${this.job.startedAt.toISOString()})`,
      );
    }
  }
}
