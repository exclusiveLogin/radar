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
    if (this.job) {
      return parsePipelineStatusResponseSchema.parse(this.buildProcessStatus(this.job));
    }
    const catchUp = await this.phasesAdmin.getIngestCatchUpState();
    if (!catchUp) return IDLE;
    return parsePipelineStatusResponseSchema.parse(this.buildCatchUpStatus(catchUp));
  }

  async startReset(): Promise<ParsePipelineStartResponse> {
    return this.startJob("reset", "parse-engine:pipeline:reset", ["--no-force-locks"]);
  }

  /** Планирует отсутствующие raw и разбирает очередь батчами без очистки таблиц. */
  async startCatchUp(): Promise<ParsePipelineStartResponse> {
    await this.assertNoRunningJob();
    const catchUp = await this.phasesAdmin.catchUpEnabledIngestPhases();
    this.logger.log(
      `catchup started: enqueued=${catchUp.enqueued}, queued=${catchUp.queued}`,
    );
    return { ok: true, kind: "catchup" };
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
      startedAt,
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

  private buildProcessStatus(job: JobState): ParsePipelineStatusResponse {
    return {
      status: job.status,
      kind: job.kind,
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

  private buildCatchUpStatus(
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
    return {
      status,
      kind: "catchup",
      startedAt,
      finishedAt,
      error:
        status === "failed"
          ? displayedRuns.find((run) => run.error)?.error ?? "catch-up run failed"
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
        `Уже выполняется catchup (с ${activeRun.startedAt ?? activeRun.createdAt})`,
      );
    }
  }
}
