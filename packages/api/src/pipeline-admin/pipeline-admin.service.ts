/**
 * ---
 * layer: api/application
 * domain: pipeline
 * purpose: Admin API: step run/reset + topology snapshot из pipeline.manifest.
 * ---
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Inject } from "@nestjs/common";
import {
  buildPipelineGraph,
  cascadeResetOrder,
  createStepResetRequestedEvent,
  createStepRunRequestedEvent,
  pipelineStepResetRequestSchema,
  pipelineStepRunRequestSchema,
  pipelineTopologyResponseSchema,
  resolveGeoEnrichmentProvider,
  topicForKnownEventType,
  type IEventTransport,
  type PipelineManifest,
  type PipelineTopologyResponse,
  type StepDescriptor,
} from "@radar/shared";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MONOREPO_ROOT } from "../monorepo-root";
import {
  PIPELINE_ADMIN_DEPENDENCIES,
  type PipelineAdminDependencies,
} from "./pipeline-admin.providers";

function loadPipelineManifestFromDisk(): PipelineManifest {
  const nodeRequire = createRequire(__filename);
  const loaderPath = join(MONOREPO_ROOT, "packages/shared/dist/pipeline/pipelineManifest.loader.js");
  const { loadPipelineManifest } = nodeRequire(loaderPath) as {
    loadPipelineManifest: (opts: { repoRoot: string }) => PipelineManifest;
  };
  return loadPipelineManifest({ repoRoot: MONOREPO_ROOT });
}

@Injectable()
export class PipelineAdminService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineAdminService.name);
  private readonly transport: IEventTransport;
  private readonly deps: PipelineAdminDependencies;
  private manifest!: PipelineManifest;

  constructor(
    @Inject(PIPELINE_ADMIN_DEPENDENCIES)
    deps: PipelineAdminDependencies,
  ) {
    this.deps = deps;
    this.transport = deps.transport;
  }

  async onModuleInit(): Promise<void> {
    this.manifest = loadPipelineManifestFromDisk();
    await this.transport.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.transport?.stop();
  }

  private requireStep(stepId: string): StepDescriptor {
    const step = this.manifest.steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException(`pipeline step ${stepId} not found`);
    if (!step.enabled) throw new BadRequestException(`pipeline step ${stepId} disabled`);
    return step;
  }

  /** POST /admin/pipeline/steps/:id/run → StepRunRequested. */
  async requestStepRun(stepId: string, body: unknown) {
    this.requireStep(stepId);
    const parsed = pipelineStepRunRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const event = createStepRunRequestedEvent({
      stepId,
      isolate: parsed.data.isolate,
      ids: parsed.data.ids,
      lane: parsed.data.lane ?? "manual",
    });
    const topic = topicForKnownEventType(event.type);
    if (!topic) throw new BadRequestException("StepRunRequested topic missing");
    await this.transport.publish(topic, [event]);

    return {
      ok: true as const,
      stepId,
      eventId: event.id,
      correlationId: event.meta?.correlationId ?? event.id,
    };
  }

  /**
   * dryRun=true → preview counts (SQL в API).
   * dryRun=false → publish StepResetRequested (worker apply cascade).
   */
  async requestStepReset(stepId: string, body: unknown) {
    this.requireStep(stepId);
    const parsed = pipelineStepResetRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);

    const cascade = parsed.data.cascade ?? true;
    const dryRun = parsed.data.dryRun ?? false;

    if (dryRun) {
      const countsByStep = await this.previewCascadeReset(stepId, cascade);
      return {
        ok: true as const,
        stepId,
        dryRun: true,
        cascade,
        countsByStep,
      };
    }

    const event = createStepResetRequestedEvent({
      stepId,
      cascade,
      dryRun: false,
    });
    const topic = topicForKnownEventType(event.type);
    if (!topic) throw new BadRequestException("StepResetRequested topic missing");
    await this.transport.publish(topic, [event]);

    return {
      ok: true as const,
      stepId,
      dryRun: false,
      cascade,
      countsByStep: {},
      eventId: event.id,
      correlationId: event.meta?.correlationId ?? event.id,
    };
  }

  /** Topology: nodes + edges (emits ∩ trigger.on) + queue/last run. */
  async getTopology(): Promise<PipelineTopologyResponse> {
    const graph = buildPipelineGraph(this.manifest);
    const allPhases = await this.deps.phases.listAll();
    const isolateStepId = await this.findActiveIsolateStepId();

    const nodes = await Promise.all(
      graph.nodes.map(async (step) => {
        const scope = step.phases?.scope;
        const phases = scope
          ? allPhases
              .filter((p) => p.scope === scope)
              .map((p) => ({
                id: p.id,
                scope: p.scope,
                enabled: p.enabled,
                order: p.order,
              }))
          : [];
        return {
          id: step.id,
          kind: step.kind,
          pipelineKey: step.pipelineKey,
          label: step.label,
          enabled: step.enabled,
          phases,
          queueDepth: await this.queueDepthForStep(step),
          lastStepRun: await this.lastStepRun(step.id),
          resetsHandler: step.resets?.handler ?? null,
        };
      }),
    );

    const edges = graph.edges.map((e) => ({
      ...e,
      suppressed: isolateStepId != null && e.fromStepId === isolateStepId,
    }));

    return pipelineTopologyResponseSchema.parse({
      version: 1,
      nodes,
      edges,
      isolateStepId,
      capturedAt: new Date().toISOString(),
    });
  }

  private async queueDepthForStep(
    step: StepDescriptor,
  ): Promise<{ pending: number; processing: number } | null> {
    const scope = step.phases?.scope;
    if (!scope) return null;

    if (scope === "ingestParse") {
      const phases = (await this.deps.phases.listAll()).filter((p) => p.scope === "ingestParse");
      let pending = 0;
      let processing = 0;
      for (const phase of phases) {
        const c = await this.deps.coverage.countByStatus(phase.id);
        pending += c.pending ?? 0;
        processing += c.processing ?? 0;
      }
      return { pending, processing };
    }

    if (scope === "geoParse") {
      const phases = (await this.deps.phases.listAll()).filter((p) => p.scope === "geoParse");
      let pending = 0;
      let processing = 0;
      for (const phase of phases) {
        const provider = resolveGeoEnrichmentProvider(phase);
        if (!provider) continue;
        const c = await this.deps.placeJobs.countByStatus(provider);
        pending += c.pending ?? 0;
        processing += c.processing ?? 0;
      }
      return { pending, processing };
    }

    return null;
  }

  private async lastStepRun(stepId: string): Promise<{
    id: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null> {
    try {
      const rows = (await this.deps.dataSource.query(
        `SELECT id, status, started_at, finished_at
         FROM log_step_run
         WHERE step_id = $1
         ORDER BY COALESCE(started_at, created_at) DESC
         LIMIT 1`,
        [stepId],
      )) as Array<{
        id: string;
        status: string;
        started_at: Date | string | null;
        finished_at: Date | string | null;
      }>;
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      };
    } catch (err) {
      this.logger.warn(
        `log_step_run unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async findActiveIsolateStepId(): Promise<string | null> {
    try {
      const rows = (await this.deps.dataSource.query(
        `SELECT step_id FROM log_step_run
         WHERE status = 'running' AND isolate = true
         ORDER BY started_at DESC
         LIMIT 1`,
      )) as Array<{ step_id: string }>;
      return rows[0]?.step_id ?? null;
    } catch {
      return null;
    }
  }

  /** Preview counts по handler'ам (без worker import). */
  private async previewCascadeReset(
    rootStepId: string,
    cascade: boolean,
  ): Promise<Record<string, Record<string, number>>> {
    const order = cascade
      ? cascadeResetOrder(this.manifest, rootStepId)
      : [rootStepId].filter((id) =>
          Boolean(this.manifest.steps.find((s) => s.id === id)?.resets?.handler),
        );

    const countsByStep: Record<string, Record<string, number>> = {};
    for (const id of order) {
      const handler = this.manifest.steps.find((s) => s.id === id)?.resets?.handler;
      if (!handler) continue;
      countsByStep[id] = await this.previewHandler(handler);
    }
    return countsByStep;
  }

  private async countTable(table: string): Promise<number> {
    const rows = (await this.deps.dataSource.query(
      `SELECT COUNT(*)::text AS count FROM ${table}`,
    )) as Array<{ count: string }>;
    return Number(rows[0]?.count ?? 0);
  }

  private async previewHandler(handler: string): Promise<Record<string, number>> {
    switch (handler) {
      case "parse":
        return {
          work_parse_message: await this.countTable("work_parse_message"),
          mat_parse_event: await this.countTable("mat_parse_event"),
          log_parse_attempt: await this.countTable("log_parse_attempt"),
        };
      case "geo":
        return {
          places: await this.countTable("places"),
          mat_parse_evidence: await this.countTable("mat_parse_evidence"),
        };
      case "tracking":
        return {
          mat_track: await this.countTable("mat_track"),
          mat_track_node: await this.countTable("mat_track_node"),
          state_track_consumed: await this.countTable("state_track_consumed"),
        };
      case "ingest":
        return {
          job_ingest_backfill: await this.countTable("job_ingest_backfill"),
          state_ingest_cursor: await this.countTable("state_ingest_cursor"),
        };
      default:
        return {};
    }
  }
}
