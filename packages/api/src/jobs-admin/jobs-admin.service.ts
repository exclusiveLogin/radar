import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  createJobDefinitionSchema,
  updateJobDefinitionSchema,
  type JobDefinition,
  type JobRun,
  type JobRunStatus,
  type JobType,
} from "@radar/shared";
import { DataSource } from "typeorm";
import {
  TypeOrmJobDefinitionRepository,
  TypeOrmJobRunRepository,
} from "../infrastructure/persistence";

/**
 * Сервис админки планировщика (ADR-003, Фаза G): CRUD определений, ручной
 * триггер запуска и история runs. Исполнение — в воркере (JobDaemon).
 */
@Injectable()
export class JobsAdminService {
  private readonly definitions: TypeOrmJobDefinitionRepository;
  private readonly runs: TypeOrmJobRunRepository;

  constructor(@InjectDataSource() dataSource: DataSource) {
    this.definitions = new TypeOrmJobDefinitionRepository(dataSource);
    this.runs = new TypeOrmJobRunRepository(dataSource);
  }

  listDefinitions(): Promise<JobDefinition[]> {
    return this.definitions.listAll();
  }

  async createDefinition(body: unknown): Promise<JobDefinition> {
    const parsed = createJobDefinitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.definitions.create(parsed.data);
  }

  async updateDefinition(id: string, body: unknown): Promise<JobDefinition> {
    const parsed = updateJobDefinitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const updated = await this.definitions.update(id, parsed.data);
    if (!updated) throw new NotFoundException(`job definition ${id} not found`);
    return updated;
  }

  async removeDefinition(id: string): Promise<{ ok: true }> {
    await this.definitions.remove(id);
    return { ok: true };
  }

  /** Ручной триггер: материализует pending job_run из определения. */
  async triggerDefinition(id: string): Promise<JobRun> {
    const def = await this.definitions.findById(id);
    if (!def) throw new NotFoundException(`job definition ${id} not found`);
    return this.runs.create({ definitionId: def.id, type: def.type, params: def.params });
  }

  listRuns(query: {
    definitionId?: string;
    type?: JobType;
    status?: JobRunStatus;
    limit?: number;
  }): Promise<JobRun[]> {
    return this.runs.list({
      definitionId: query.definitionId,
      type: query.type,
      status: query.status,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  async getRun(id: string): Promise<JobRun> {
    const run = await this.runs.findById(id);
    if (!run) throw new NotFoundException(`job run ${id} not found`);
    return run;
  }

  async cancelRun(id: string): Promise<{ ok: true }> {
    const run = await this.runs.findById(id);
    if (!run) throw new NotFoundException(`job run ${id} not found`);
    await this.runs.updateStatus(id, "canceled");
    return { ok: true };
  }
}
