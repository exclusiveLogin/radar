import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  parsePipelineStatusResponseSchema,
  type ParsePipelineJobKind,
  type ParsePipelineStartResponse,
  type ParsePipelineStatusResponse,
} from "@radar/shared";
import { spawn, type ChildProcess } from "child_process";
import type { DataSource } from "typeorm";
import { MONOREPO_ROOT } from "../monorepo-root";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";

type JobState = {
  kind: ParsePipelineJobKind;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  totalMessages: number;
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
 * Запуск parse pipeline reset / reparse через worker CLI в фоне.
 * Прогресс reparse — по log_parse_attempt с момента старта job.
 */
@Injectable()
export class ParsePipelineAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(ParsePipelineAdminService.name);
  private job: JobState | null = null;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly phasesAdmin: PhasesAdminService,
  ) {}

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

  /** Полный reparse + drain scheduled (как 
`npm run radar -- parse run`). */
  async startReparse(): Promise<ParsePipelineStartResponse> {
    return this.startJob("reparse", "parse-engine:rebuild:drain", ["--no-force-locks"]);
  }

  private async startJob(
    kind: ParsePipelineJobKind,
    npmScript: string,
    extraArgs: string[],
  ): Promise<ParsePipelineStartResponse> {
    if (this.job?.status === "running") {
      throw new BadRequestException(
        `Уже выполняется ${this.job.kind} (с ${this.job.startedAt.toISOString()})`,
      );
    }

    const totalMessages = await this.countRawMessages();
    const startedAt = new Date();
    const child = this.spawnWorkerScript(npmScript, extraArgs);

    this.job = {
      kind,
      status: "running",
      startedAt,
      totalMessages: kind === "reparse" ? totalMessages : 0,
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

    if (job.kind !== "reparse") {
      if (job.status === "running") base.percentApprox = 0;
      else base.percentApprox = job.status === "completed" ? 100 : 0;
      return base;
    }

    const [progress] = await this.ds.query<
      Array<{ processed: string; ok: string; failed: string }>
    >(
      `SELECT
         COUNT(*)::text AS processed,
         COUNT(*) FILTER (WHERE status = 'ok')::text AS ok,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
       FROM log_parse_attempt
       WHERE created_at >= $1`,
      [job.startedAt],
    );

    const processedMessages = Number(progress?.processed ?? 0);
    const ok = Number(progress?.ok ?? 0);
    const failed = Number(progress?.failed ?? 0);
    const total = job.totalMessages;
    const percentApprox =
      total > 0
        ? Math.min(100, Math.round((processedMessages / total) * 100))
        : job.status === "completed"
          ? 100
          : 0;

    return {
      ...base,
      processedMessages,
      ok,
      failed,
      percentApprox,
    };
  }

  private async countRawMessages(): Promise<number> {
    const [row] = await this.ds.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM mat_ingest_raw`,
    );
    return Number(row?.count ?? 0);
  }
}
