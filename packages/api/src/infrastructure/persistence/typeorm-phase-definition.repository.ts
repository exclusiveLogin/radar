import type {
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  PhaseManifestEntry,
  PhasePolicy,
  PhaseTrigger,
} from "@radar/shared";
import { DEFAULT_PHASE_POLICY, phasePolicySchema } from "@radar/shared";
import type { DataSource } from "typeorm";

type PhaseRow = {
  id: string;
  trigger: string;
  enrichers: PhaseManifestEntry["enrichers"];
  policy: Record<string, unknown>;
  enabled: boolean;
  order_index: number;
  updated_at: Date;
};

/** Реестр фаз обогащения на Postgres (v2). */
export class TypeOrmPhaseDefinitionRepository implements IPhaseDefinitionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listAll(): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions ORDER BY order_index`,
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async listEnabled(trigger?: PhaseTrigger): Promise<PhaseDefinitionRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions
       WHERE enabled = true AND ($1::text IS NULL OR trigger = $1)
       ORDER BY order_index`,
      [trigger ?? null],
    )) as PhaseRow[];
    return rows.map((row) => this.toRecord(row));
  }

  async findById(id: string): Promise<PhaseDefinitionRecord | null> {
    const rows = (await this.dataSource.query(
      `SELECT id, trigger, enrichers, policy, enabled, order_index, updated_at
       FROM phase_definitions WHERE id = $1`,
      [id],
    )) as PhaseRow[];
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async upsert(entry: PhaseManifestEntry): Promise<void> {
    // legacy columns kind/stage — NOT NULL в старой схеме до отдельной миграции drop
    const legacyKind = entry.trigger === "eager" ? "eager" : "lazy";
    const legacyStage = entry.trigger === "scheduled" ? entry.id : null;

    await this.dataSource.query(
      `INSERT INTO phase_definitions (id, kind, stage, trigger, enrichers, policy, enabled, order_index, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, now())
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         stage = EXCLUDED.stage,
         trigger = EXCLUDED.trigger,
         enrichers = EXCLUDED.enrichers,
         policy = EXCLUDED.policy,
         order_index = EXCLUDED.order_index,
         updated_at = now()`,
      [
        entry.id,
        legacyKind,
        legacyStage,
        entry.trigger,
        JSON.stringify(entry.enrichers),
        JSON.stringify(entry.policy),
        entry.enabled,
        entry.order,
      ],
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.dataSource.query(
      `UPDATE phase_definitions SET enabled = $2, updated_at = now() WHERE id = $1`,
      [id, enabled],
    );
  }

  async updatePolicy(id: string, policy: Partial<PhasePolicy>): Promise<void> {
    const current = await this.findById(id);
    if (!current) return;
    const merged = phasePolicySchema.parse({ ...current.policy, ...policy });
    await this.dataSource.query(
      `UPDATE phase_definitions SET policy = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(merged)],
    );
  }

  private toRecord(row: PhaseRow): PhaseDefinitionRecord {
    return {
      id: row.id,
      trigger: row.trigger as PhaseTrigger,
      enrichers: row.enrichers,
      policy: phasePolicySchema.parse({ ...DEFAULT_PHASE_POLICY, ...row.policy }),
      enabled: row.enabled,
      order: row.order_index,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
